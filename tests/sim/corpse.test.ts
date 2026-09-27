import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../src/sim/campaign.ts';
import { resolveTurn } from '../../src/sim/core/turn.ts';
import {
  corpseStageForAge,
  createCorpseFromGod,
  harvestCorpse,
  resolveCorpses,
} from '../../src/sim/gods/corpse.ts';

describe('God permanent death, finite remains, and corpse geography (master Section 10.1, 10.2, 10.3)', () => {
  it('transitions dying God to DEAD, creates physical corpse state, applies death shock, and logs GOD_DIED', () => {
    const state = createCampaign({ seed: 'death-test', size: 'small', civCount: 2 });
    const god = state.gods[0]!;
    const settlement = state.settlements[0]!;
    const initialLegitimacy = settlement.legitimacy;

    // Reduce vital health to 0
    god.vitalHealth = 0;
    const res = resolveTurn(state, []);
    const deadGod = res.state.gods.find((g) => g.id === god.id)!;

    expect(deadGod.lifecycle).toBe('DEAD');
    expect(res.state.corpses).toHaveLength(1);

    const corpse = res.state.corpses[0]!;
    expect(corpse.godId).toBe(god.id);
    expect(corpse.stage).toBe('RECENT');
    expect(corpse.tissueReserve).toBe(100 * 100); // size 1 mass = 1 -> 100 units
    expect(corpse.mineralReserve).toBe(60 * 100); // 60 units
    expect(corpse.contamination).toBe(400); // 40 * 1 * 10

    // Death shock: settlement legitimacy drops by 150
    expect(res.state.settlements[0]!.legitimacy).toBe(Math.max(0, initialLegitimacy - 150));

    // GOD_DIED event logged in history
    const deathEvent = res.state.history.find((h) => h.type === 'GOD_DIED');
    expect(deathEvent).toBeDefined();
    expect(deathEvent?.payload.godId).toBe(god.id);
  });

  it('progresses through decay stages from RECENT to DECAY, OSSUARY, and FOSSIL', () => {
    expect(corpseStageForAge(0)).toBe('RECENT');
    expect(corpseStageForAge(3)).toBe('RECENT');
    expect(corpseStageForAge(4)).toBe('DECAY');
    expect(corpseStageForAge(23)).toBe('DECAY');
    expect(corpseStageForAge(24)).toBe('OSSUARY');
    expect(corpseStageForAge(79)).toBe('OSSUARY');
    expect(corpseStageForAge(80)).toBe('FOSSIL');
    expect(corpseStageForAge(150)).toBe('FOSSIL');
  });

  it('halves decay rate when site preservation is active, consuming medicine and coin', () => {
    const state = createCampaign({ seed: 'preservation-test', size: 'small', civCount: 2 });
    const god = state.gods[0]!;
    const settlement = state.settlements[0]!;
    const civ = state.civs[0]!;

    civ.coin = 20;
    settlement.storage.MEDICINE = 1000;

    const corpse = createCorpseFromGod(state, god);
    corpse.preserved = true;
    state.corpses.push(corpse);

    resolveCorpses(state);

    // Consumed 2 COIN and 200 MEDICINE (2 units)
    expect(civ.coin).toBe(18);
    expect(settlement.storage.MEDICINE).toBe(800);
    // Preserved advances by 0.5 turns instead of 1.0
    expect(corpse.ageTurns).toBe(0.5);
  });

  it('permits BIO tissue extraction from RECENT/DECAY corpses and accelerates decay', () => {
    const state = createCampaign({ seed: 'harvest-test', size: 'small', civCount: 2 });
    const god = state.gods[0]!;
    const settlement = state.settlements[0]!;

    // Position corpse at settlement
    const corpse = createCorpseFromGod(state, god);
    state.corpses.push(corpse);

    // Harvest 10 BIO units
    const harvestResult = harvestCorpse(state, settlement.id, god.id, 'BIO', 10);
    expect(harvestResult.ok).toBe(true);
    expect(harvestResult.harvested).toBe(10);
    expect(settlement.storage.BIO).toBe(1000); // 10 units
    expect(corpse.tissueReserve).toBe(9000); // 100 - 10 = 90 units

    // Section 10.2: 10 BIO taken advances decay by Math.ceil(10 / 5) = 2 turns
    expect(corpse.ageTurns).toBe(2);

    // Event logged
    const harvestEvent = state.history.find((h) => h.type === 'CORPSE_HARVESTED');
    expect(harvestEvent).toBeDefined();
    expect(harvestEvent?.payload.resource).toBe('BIO');
    expect(harvestEvent?.payload.units).toBe(10);
  });

  it('permits mineral extraction from OSSUARY and FOSSIL stages but disallows flesh extraction', () => {
    const state = createCampaign({ seed: 'ossuary-harvest-test', size: 'small', civCount: 2 });
    const god = state.gods[0]!;
    const settlement = state.settlements[0]!;

    const corpse = createCorpseFromGod(state, god);
    corpse.stage = 'OSSUARY';
    corpse.ageTurns = 30;
    state.corpses.push(corpse);

    // BIO extraction should fail in OSSUARY stage
    const bioResult = harvestCorpse(state, settlement.id, god.id, 'BIO', 5);
    expect(bioResult.ok).toBe(false);
    expect(bioResult.reason).toContain('exhausted');

    // Mineral extraction should succeed
    const minResult = harvestCorpse(state, settlement.id, god.id, 'STONE', 15);
    expect(minResult.ok).toBe(true);
    expect(minResult.harvested).toBe(15);
    expect(corpse.mineralReserve).toBe(4500); // 60 - 15 = 45 units
    expect(settlement.storage.STONE).toBeGreaterThanOrEqual(1500);
  });
});
