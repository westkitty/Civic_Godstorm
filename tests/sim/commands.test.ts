import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../src/sim/campaign.ts';
import type { Command } from '../../src/sim/core/commands.ts';
import type { CampaignState } from '../../src/sim/core/state.ts';
import { resolveTurn } from '../../src/sim/core/turn.ts';

const state0 = (): CampaignState => createCampaign({ seed: 'cmd-1', size: 'standard', civCount: 2 });

function build(state: CampaignState, overrides: Partial<Command> & Pick<Command, 'kind' | 'options'>): Command {
  const settlement = state.settlements[0];
  if (!settlement) throw new Error('no settlement');
  return {
    commandId: 'c1', civId: settlement.ownerId, actorId: settlement.id, issuedForTurn: state.turn + 1, sequence: 1,
    target: null, consent: {}, expectedStateVersion: state.turn, ...overrides,
  };
}

const codes = (state: CampaignState, commands: Command[]): string[] => resolveTurn(state, commands).rejections.map((r) => r.code);

describe('command validation', () => {
  it('rejects stale state versions and foreign actors with stable codes', () => {
    const state = state0();
    const jobs = { farm: 2000, forestry: 1000, quarry: 0, builder: 750 };
    expect(codes(state, [build(state, { kind: 'SET_JOBS', options: jobs, expectedStateVersion: 5 })])).toEqual(['STALE_STATE']);
    const foreign = state.settlements[1];
    expect(codes(state, [build(state, { kind: 'SET_JOBS', options: jobs, actorId: foreign?.id ?? -1 })])).toEqual(['NOT_OWNER']);
  });

  it('rejects labour over capacity and malformed allocations', () => {
    const state = state0();
    expect(codes(state, [build(state, { kind: 'SET_JOBS', options: { farm: 2000, forestry: 1000, quarry: 0, builder: 751 } })])).toEqual(['CAPACITY_REACHED']);
    expect(codes(state, [build(state, { kind: 'SET_JOBS', options: { farm: -1, forestry: 0, quarry: 0, builder: 0 } })])).toEqual(['UNSUPPORTED_STATE']);
    expect(codes(state, [build(state, { kind: 'SET_JOBS', options: { farm: 1.5, forestry: 0, quarry: 0, builder: 0 } })])).toEqual(['UNSUPPORTED_STATE']);
  });

  it('rejects unaffordable construction without touching stock', () => {
    const state = state0();
    const settlement = state.settlements[0];
    if (!settlement) throw new Error('no settlement');
    settlement.storage.STONE = 700;
    const result = resolveTurn(state, [build(state, { kind: 'QUEUE_BUILD', target: settlement.cell, options: { build: 'DWELLING' } })]);
    expect(result.rejections.map((r) => r.code)).toEqual(['INSUFFICIENT_STOCK']);
    expect(result.state.settlements[0]?.queue).toEqual([]);
  });

  it('never spends twice for a repeated command ID', () => {
    const state = state0();
    const settlement = state.settlements[0];
    if (!settlement) throw new Error('no settlement');
    const order = build(state, { kind: 'QUEUE_BUILD', target: settlement.cell, options: { build: 'DWELLING' } });
    const result = resolveTurn(state, [order, { ...order, sequence: 2 }]);
    expect(result.accepted).toEqual(['c1']);
    expect(result.rejections.map((r) => r.reason)).toEqual(['duplicate command ID']);
    expect(result.state.settlements[0]?.queue).toHaveLength(1);
  });

  it('refunds an untouched reservation on cancel', () => {
    let state = state0();
    const settlement = state.settlements[0];
    if (!settlement) throw new Error('no settlement');
    state = resolveTurn(state, [build(state, { kind: 'SET_JOBS', options: { farm: 2000, forestry: 1000, quarry: 0, builder: 0 } })]).state;
    const stone = state.settlements[0]?.storage.STONE ?? 0;
    state = resolveTurn(state, [build(state, { kind: 'QUEUE_BUILD', target: settlement.cell, options: { build: 'DWELLING' } })]).state;
    const itemId = state.settlements[0]?.queue[0]?.id ?? -1;
    state = resolveTurn(state, [build(state, { kind: 'CANCEL_BUILD', options: { itemId } })]).state;
    expect(state.settlements[0]?.queue).toEqual([]);
    expect(state.settlements[0]?.storage.STONE).toBe(stone);
  });

  it('never mutates the committed input state', () => {
    const state = state0();
    const snapshot = JSON.stringify(state);
    resolveTurn(state, [build(state, { kind: 'QUEUE_BUILD', target: state.settlements[0]?.cell ?? 0, options: { build: 'DWELLING' } })]);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
