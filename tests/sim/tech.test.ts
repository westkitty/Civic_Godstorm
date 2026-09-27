import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../src/sim/campaign.ts';
import { resolveTurn } from '../../src/sim/core/turn.ts';
import type { CampaignState, SettlementState } from '../../src/sim/core/state.ts';
import type { Command } from '../../src/sim/core/commands.ts';
import { units } from '../../src/sim/core/quantity.ts';

function fresh(seed = 'tech-campaign'): CampaignState {
  return createCampaign({ seed, size: 'standard', civCount: 2 });
}

const capital = (state: CampaignState): SettlementState => state.settlements[0] as SettlementState;

function civCommand(state: CampaignState, partial: Partial<Command> & Pick<Command, 'kind' | 'options'>): Command {
  const settlement = capital(state);
  return {
    commandId: `t${state.turn}:${partial.kind}:${JSON.stringify(partial.options)}`,
    civId: settlement.ownerId,
    actorId: settlement.id,
    issuedForTurn: state.turn + 1,
    sequence: 1,
    target: null,
    consent: {},
    expectedStateVersion: state.turn,
    ...partial,
  };
}

describe('technology graph and research progression (master Section 7.1)', () => {
  it('validates prerequisites and rejects locked or invalid technologies', () => {
    const state = fresh('tech-prereq');

    // T-PRO-2 requires T-PRO-1 and T-ECO-1
    const lockedCmd = civCommand(state, { kind: 'RESEARCH_TECH', options: { techId: 'T-PRO-2' } });
    const resLocked = resolveTurn(state, [lockedCmd]);
    expect(resLocked.rejections.length).toBeGreaterThan(0);
    expect(resLocked.rejections[0]?.code).toBe('PREREQUISITE_MISSING');

    // Unknown tech
    const unknownCmd = civCommand(state, { kind: 'RESEARCH_TECH', options: { techId: 'T-UNKNOWN-99' } });
    const resUnknown = resolveTurn(state, [unknownCmd]);
    expect(resUnknown.rejections.length).toBeGreaterThan(0);
    expect(resUnknown.rejections[0]?.code).toBe('UNSUPPORTED_STATE');
  });

  it('accumulates research knowledge and completes technologies with history events', () => {
    let state = fresh('tech-progress');
    const civId = capital(state).ownerId;

    // Order research for tier 1 tech T-PRO-1 (cost: 60 KNOWLEDGE = 6000 hundredths)
    const researchCmd = civCommand(state, { kind: 'RESEARCH_TECH', options: { techId: 'T-PRO-1' } });
    const res1 = resolveTurn(state, [researchCmd]);
    expect(res1.rejections).toEqual([]);
    state = res1.state;

    // Grant KNOWLEDGE directly to treasury and advance turn to complete research
    const civ = state.civs.find((c) => c.id === civId)!;
    civ.knowledge += units(60);

    state = resolveTurn(state, []).state;

    const updatedCiv = state.civs.find((c) => c.id === civId)!;
    expect(updatedCiv.completedTechs).toContain('T-PRO-1');
    expect(updatedCiv.currentResearch).toBeNull();

    // Verify history event
    const event = state.history.find((h) => h.type === 'TECH_RESEARCHED' && h.payload.techId === 'T-PRO-1');
    expect(event).toBeDefined();

    // Now researching T-PRO-1 again should be rejected as already completed
    const duplicateCmd = civCommand(state, { kind: 'RESEARCH_TECH', options: { techId: 'T-PRO-1' } });
    const resDup = resolveTurn(state, [duplicateCmd]);
    expect(resDup.rejections.length).toBeGreaterThan(0);
    expect(resDup.rejections[0]?.code).toBe('CAPACITY_REACHED');
  });
});

describe('policy adoption and governance (master Section 7.2)', () => {
  it('enforces cost, cooldowns, and tech gate for advanced axes', () => {
    let state = fresh('policy-test');
    const civId = capital(state).ownerId;
    const initialCoin = state.civs.find((c) => c.id === civId)!.coin;

    // 1. Advanced axis (SECURITY) requires T-INS-2
    const advCmd = civCommand(state, {
      kind: 'ADOPT_POLICY',
      options: { axis: 'SECURITY', choice: 'P-MILITARIZE' },
    });
    const resAdv = resolveTurn(state, [advCmd]);
    expect(resAdv.rejections.length).toBeGreaterThan(0);
    expect(resAdv.rejections[0]?.code).toBe('PREREQUISITE_MISSING');

    // 2. Available axis (RESOURCE_ETHICS) succeeds
    const policyCmd = civCommand(state, {
      kind: 'ADOPT_POLICY',
      options: { axis: 'RESOURCE_ETHICS', choice: 'P-STEWARDSHIP' },
    });
    const resPolicy = resolveTurn(state, [policyCmd]);
    expect(resPolicy.rejections).toEqual([]);
    state = resPolicy.state;

    const civ = state.civs.find((c) => c.id === civId)!;
    // Costs 20 COIN
    expect(civ.coin).toBe(initialCoin - units(20) - units(2) + units(5)); // -20 policy -2 upkeep +5 dues
    expect(civ.policies.RESOURCE_ETHICS).toBe('P-STEWARDSHIP');
    expect(civ.policyCooldowns.RESOURCE_ETHICS).toBe(9); // 10 minus 1 turn resolution

    // 3. Changing during cooldown is rejected
    const changeCmd = civCommand(state, {
      kind: 'ADOPT_POLICY',
      options: { axis: 'RESOURCE_ETHICS', choice: 'P-EXTRACTION' },
    });
    const resChange = resolveTurn(state, [changeCmd]);
    expect(resChange.rejections.length).toBeGreaterThan(0);
    expect(resChange.rejections[0]?.code).toBe('CAPACITY_REACHED');

    // 4. Verify history event
    const event = state.history.find(
      (h) => h.type === 'POLICY_ADOPTED' && h.payload.choice === 'P-STEWARDSHIP',
    );
    expect(event).toBeDefined();
  });

  it('applies P-FIXED-TENURE storage boost to settlements', () => {
    let state = fresh('fixed-tenure-effect');
    const civId = capital(state).ownerId;

    // Adopt P-FIXED-TENURE on SETTLEMENT_FORM axis
    const cmd = civCommand(state, {
      kind: 'ADOPT_POLICY',
      options: { axis: 'SETTLEMENT_FORM', choice: 'P-FIXED-TENURE' },
    });
    state = resolveTurn(state, [cmd]).state;

    const civ = state.civs.find((c) => c.id === civId)!;
    expect(civ.policies.SETTLEMENT_FORM).toBe('P-FIXED-TENURE');

    // With 60 base food stock and base 40 storage:
    // Without fixed tenure: 40 base storage -> 20 overflow spoils.
    // With fixed tenure: 40 + 20 = 60 storage -> 0 overflow spoils!
    const set = capital(state);
    set.storage.FOOD = units(60);
    const turnRes = resolveTurn(state, []);
    const summary = turnRes.state.lastTurn?.settlements.find((s) => s.settlementId === set.id);
    expect(summary?.spoiled.FOOD).toBe(0);
  });
});
