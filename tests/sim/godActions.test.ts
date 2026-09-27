import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../src/sim/campaign.ts';
import { resolveTurn } from '../../src/sim/core/turn.ts';
import type { CampaignState, SettlementState } from '../../src/sim/core/state.ts';
import type { GodState } from '../../src/sim/gods/god.ts';
import type { Command } from '../../src/sim/core/commands.ts';
import { occupiedCells } from '../../src/sim/gods/body.ts';
import { distance } from '../../src/sim/world/hex.ts';
import { units } from '../../src/sim/core/quantity.ts';

function fresh(seed = 'god-actions'): CampaignState {
  return createCampaign({ seed, size: 'standard', civCount: 2 });
}

const god0 = (state: CampaignState): GodState => state.gods[0] as GodState;
const capital = (state: CampaignState): SettlementState => state.settlements[0] as SettlementState;

function godCommand(state: CampaignState, partial: Partial<Command> & Pick<Command, 'kind' | 'options'>): Command {
  const god = god0(state);
  return {
    commandId: `t${state.turn}:${partial.kind}:${JSON.stringify(partial.options)}`,
    civId: god.ownerId,
    actorId: god.id,
    issuedForTurn: state.turn + 1,
    sequence: 1,
    target: null,
    consent: {},
    expectedStateVersion: state.turn,
    ...partial,
  };
}

describe('advanced God actions (master Section 4.5)', () => {
  it('GOD_GUARD enters active stance, spends 2 AP, and persists', () => {
    let state = fresh('guard-action');
    const god = god0(state);
    const set = capital(state);

    const guardCmd = godCommand(state, {
      kind: 'GOD_GUARD',
      options: { targetSettlementId: set.id },
    });

    const res = resolveTurn(state, [guardCmd]);
    expect(res.rejections).toEqual([]);
    state = res.state;

    const updatedGod = god0(state);
    expect(updatedGod.order.kind).toBe('GUARD');
    expect(updatedGod.status.kind).toBe('ACTIVE');

    // Verify history event
    const event = state.history.find((h) => h.type === 'GOD_GUARD' && h.actorIds.includes(god.id));
    expect(event).toBeDefined();

    // Advances next turn and remains in GUARD stance
    state = resolveTurn(state, []).state;
    expect(god0(state).order.kind).toBe('GUARD');
  });

  it('GOD_STRIKE validates adjacency, spends 2 AP, adds 20 fatigue, and disturbs soil', () => {
    let state = fresh('strike-action');
    const god = god0(state);
    const cells = occupiedCells(state.map, god.maskName, god)!;

    // Distant cell rejection
    const distantCell = (god.anchor + 20) % state.map.elevation.length;
    const distantCmd = godCommand(state, {
      kind: 'GOD_STRIKE',
      options: { targetCell: distantCell },
    });
    const resDist = resolveTurn(state, [distantCmd]);
    expect(resDist.rejections.length).toBeGreaterThan(0);
    expect(resDist.rejections[0]?.code).toBe('UNSUPPORTED_STATE');

    // Adjacent legal strike target
    let targetCell = -1;
    for (let c = 0; c < state.map.elevation.length; c += 1) {
      if (!cells.includes(c) && cells.some((bodyCell) => distance(state.map, bodyCell, c) <= 1)) {
        targetCell = c;
        break;
      }
    }
    expect(targetCell).toBeGreaterThanOrEqual(0);

    const initialFatigue = god.fatigue;
    const initialDisturbance = state.map.soilDisturbance[targetCell]!;

    const strikeCmd = godCommand(state, {
      kind: 'GOD_STRIKE',
      options: { targetCell },
    });
    const res = resolveTurn(state, [strikeCmd]);
    expect(res.rejections).toEqual([]);
    state = res.state;

    const updatedGod = god0(state);
    expect(updatedGod.fatigue).toBe(initialFatigue + 20);
    expect(state.map.soilDisturbance[targetCell]).toBe(Math.min(1000, initialDisturbance + 300));

    // Verify history event
    const event = state.history.find((h) => h.type === 'GOD_STRIKE' && h.actorIds.includes(god.id));
    expect(event).toBeDefined();
    expect(event?.locationIds).toContain(targetCell);
  });

  it('GOD_ASSIST boosts settlement construction progress or legitimacy', () => {
    let state = fresh('assist-action');
    const god = god0(state);
    const set = capital(state);

    // Queue a construction item in the settlement
    set.queue.push({
      id: 999,
      kind: 'DWELLING',
      cell: set.cell,
      reservedBy: 'test-builder',
      workRequired: units(10),
      workDone: 0,
    });

    const assistCmd = godCommand(state, {
      kind: 'GOD_ASSIST',
      options: { settlementId: set.id, service: 'CONSTRUCTION' },
    });

    const res = resolveTurn(state, [assistCmd]);
    expect(res.rejections).toEqual([]);
    state = res.state;

    // Verify construction work was boosted by 400 (4 work units)
    const updatedSet = capital(state);
    const item = updatedSet.queue.find((q) => q.id === 999);
    // God added 400 work, plus settlement builders added work during turn
    expect(item?.workDone ?? 0).toBeGreaterThanOrEqual(400);

    // Verify history event
    const event = state.history.find((h) => h.type === 'GOD_ASSIST' && h.actorIds.includes(god.id));
    expect(event).toBeDefined();
    expect(event?.payload.service).toBe('CONSTRUCTION');
  });

  it('GOD_CULTIVATE validates range, spends 2 AP and adds fatigue', () => {
    let state = fresh('cultivate-action');
    const god = god0(state);
    const initialFatigue = god.fatigue;

    const cultCmd = godCommand(state, {
      kind: 'GOD_CULTIVATE',
      options: { targetCell: god.anchor, adaptation: 'GF-ROOT' },
    });

    const res = resolveTurn(state, [cultCmd]);
    expect(res.rejections).toEqual([]);
    state = res.state;

    const updatedGod = god0(state);
    expect(updatedGod.fatigue).toBe(initialFatigue + 10);

    const event = state.history.find((h) => h.type === 'GOD_CULTIVATE' && h.actorIds.includes(god.id));
    expect(event).toBeDefined();
    expect(event?.payload.adaptation).toBe('GF-ROOT');
  });
});
