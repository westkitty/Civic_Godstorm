import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../src/sim/campaign.ts';
import { resolveTurn } from '../../src/sim/core/turn.ts';
import type { CampaignState, SettlementState } from '../../src/sim/core/state.ts';
import type { Command } from '../../src/sim/core/commands.ts';

function fresh(seed = 'econ-1'): CampaignState {
  return createCampaign({ seed, size: 'standard', civCount: 2 });
}

const capital = (state: CampaignState): SettlementState => state.settlements[0] as SettlementState;

function command(state: CampaignState, partial: Partial<Command> & Pick<Command, 'kind' | 'options'>): Command {
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

describe('opening food arithmetic (Sections 6.2, 16.5)', () => {
  it('five population: 3750 labour, two farmers make 8 FOOD, base 2, households eat exactly 10', () => {
    const state = fresh();
    const settlement = capital(state);
    expect(settlement.populationMilli).toBe(5000);
    expect(Math.floor((settlement.populationMilli * 750) / 1000)).toBe(3750);
    expect(settlement.jobs).toEqual({ farm: 2000, forestry: 1000, quarry: 0, builder: 750 });
    const { state: next } = resolveTurn(state, []);
    const summary = next.lastTurn?.settlements.find((s) => s.settlementId === settlement.id);
    expect(summary?.produced.FOOD).toBe(1000);
    expect(summary?.requiredFood).toBe(1000);
    expect(summary?.consumedFood).toBe(1000);
    expect(summary?.produced.TIMBER).toBe(300);
    // 60 FOOD start is above the 40 base capacity: 10% of the 20 overflow spoils.
    expect(summary?.spoiled.FOOD).toBe(200);
    expect(capital(next).storage.FOOD).toBe(5800);
    expect(capital(next).welfare).toBe(875);
    expect(summary?.births).toBe(50);
  });

  it('carries fractional worker output exactly across turns', () => {
    let state = fresh('econ-carry');
    state = resolveTurn(state, [command(state, { kind: 'SET_JOBS', options: { farm: 333, forestry: 0, quarry: 0, builder: 0 } })]).state;
    let farmFood = (state.lastTurn?.settlements[0]?.produced.FOOD ?? 0) - 200;
    for (let turn = 1; turn < 10; turn += 1) {
      state = resolveTurn(state, []).state;
      farmFood += (state.lastTurn?.settlements[0]?.produced.FOOD ?? 0) - 200;
    }
    // 4 FOOD x 0.333 workers x 10 turns = 13.32 FOOD = 1332 hundredths exactly.
    expect(farmFood).toBe(1332);
  });
});

describe('shortage and famine', () => {
  it('waits two shortage turns before deaths and never goes negative', () => {
    let state = fresh('famine');
    capital(state).storage.FOOD = 0;
    state = resolveTurn(state, [command(state, { kind: 'SET_JOBS', options: { farm: 0, forestry: 0, quarry: 0, builder: 0 } })]).state;
    const deaths: number[] = [state.lastTurn?.settlements[0]?.deaths ?? -1];
    for (let turn = 0; turn < 60; turn += 1) {
      state = resolveTurn(state, []).state;
      deaths.push(state.lastTurn?.settlements[0]?.deaths ?? -1);
      expect(capital(state).populationMilli).toBeGreaterThanOrEqual(0);
    }
    expect(deaths.slice(0, 2)).toEqual([0, 0]);
    // Base 2 FOOD covers 200/1000 of five population: unfed 4000 milli, 10% dies.
    expect(deaths[2]).toBe(400);
    expect(capital(state).populationMilli).toBeLessThan(5000);
  });
});

describe('construction', () => {
  it('reserves materials at queue time and completes after the required work', () => {
    let state = fresh('build');
    const before = { ...capital(state).storage };
    const queued = resolveTurn(state, [command(state, { kind: 'QUEUE_BUILD', target: capital(state).cell, options: { build: 'DWELLING' } })]);
    expect(queued.rejections).toEqual([]);
    state = queued.state;
    expect(before.STONE - capital(state).storage.STONE).toBe(800);
    // 750 milli builders make 3 work/turn; a DWELLING needs 10.
    const completedOn: number[] = [];
    for (let turn = 0; turn < 5; turn += 1) {
      state = resolveTurn(state, []).state;
      if (state.lastTurn?.settlements[0]?.completed.includes('DWELLING')) completedOn.push(state.turn);
    }
    expect(completedOn).toEqual([4]);
    expect(capital(state).dwellings).toBe(1);
  });
});
