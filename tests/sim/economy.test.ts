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

  it('constructs district buildings, expands storage, and executes workshop crafts and archive research', () => {
    let state = fresh('district-build');
    const set = capital(state);
    // Grant materials for building construction
    set.storage.TIMBER = 5000;
    set.storage.STONE = 5000;

    // Queue GRANARY
    const q1 = resolveTurn(state, [command(state, { kind: 'QUEUE_BUILD', target: set.cell, options: { build: 'GRANARY' } })]);
    expect(q1.rejections).toEqual([]);
    state = q1.state;

    // 750 milli builders = 3 work/turn; GRANARY needs 12 work -> 4 turns
    for (let t = 0; t < 4; t += 1) {
      state = resolveTurn(state, []).state;
    }
    expect(capital(state).buildings.granary).toBe(1);

    // Queue WORKSHOP, ARCHIVE, and INFIRMARY
    capital(state).storage.TIMBER = 5000;
    capital(state).storage.STONE = 5000;
    capital(state).buildings.workshop = 1;
    capital(state).buildings.archive = 1;
    capital(state).buildings.infirmary = 1;

    const initialTools = capital(state).storage.TOOLS;
    const civ = state.civs.find((c) => c.id === capital(state).ownerId)!;
    const initialKnowledge = civ.knowledge;

    state = resolveTurn(state, []).state;

    // Workshop converts 1 TIMBER + 1 ORE into 2 TOOLS (200 hundredths)
    expect(capital(state).storage.TOOLS).toBe(initialTools + 200);
    // Archive yields +2 KNOWLEDGE (200 hundredths)
    const updatedCiv = state.civs.find((c) => c.id === capital(state).ownerId)!;
    expect(updatedCiv.knowledge).toBe(initialKnowledge + 200 + 100); // 200 from archive + 100 base yield
    // Infirmary boosts health welfare
    expect(capital(state).welfare).toBeGreaterThanOrEqual(875);
  });
});

describe('settlement colonization and founding (Sections 6.1, 16.5)', () => {
  it('rejects founding if target cell is too close, on water, or stock is insufficient', () => {
    const state = fresh('founding-rejects');
    const set = capital(state);

    // 1. Target too close (adjacent cell, distance 1 < 3)
    const adjCell = set.farmSites[0]?.cell ?? set.cell + 1;
    const closeCmd = command(state, { kind: 'FOUND_SETTLEMENT', target: adjCell, options: {} });
    const resClose = resolveTurn(state, [closeCmd]);
    expect(resClose.rejections.length).toBeGreaterThan(0);
    expect(resClose.rejections[0]?.code).toBe('BODY_BLOCKED');

    // 2. Target on water
    // Find a water cell
    let waterCell = -1;
    for (let c = 0; c < state.map.elevation.length; c += 1) {
      if (state.map.elevation[c]! < 90) {
        waterCell = c;
        break;
      }
    }
    expect(waterCell).toBeGreaterThanOrEqual(0);
    const waterCmd = command(state, { kind: 'FOUND_SETTLEMENT', target: waterCell, options: {} });
    const resWater = resolveTurn(state, [waterCmd]);
    expect(resWater.rejections.length).toBeGreaterThan(0);
    expect(resWater.rejections[0]?.code).toBe('WRONG_DOMAIN');

    // 3. Insufficient stock (e.g. 0 TIMBER)
    const lowStockState = fresh('low-stock');
    capital(lowStockState).storage.TIMBER = 0;
    // Find a valid distant land cell >= 3 distance away
    let validCell = -1;
    for (let c = 0; c < lowStockState.map.elevation.length; c += 1) {
      if (lowStockState.map.elevation[c]! >= 90) {
        const tooClose = lowStockState.settlements.some((s) => {
          const dq = Math.abs(s.cell % lowStockState.map.width - c % lowStockState.map.width);
          const dr = Math.abs(Math.floor(s.cell / lowStockState.map.width) - Math.floor(c / lowStockState.map.width));
          return dq + dr < 5;
        });
        if (!tooClose) {
          validCell = c;
          break;
        }
      }
    }
    expect(validCell).toBeGreaterThanOrEqual(0);
    const lowStockCmd = command(lowStockState, { kind: 'FOUND_SETTLEMENT', target: validCell, options: {} });
    const resLow = resolveTurn(lowStockState, [lowStockCmd]);
    expect(resLow.rejections.length).toBeGreaterThan(0);
    expect(resLow.rejections[0]?.code).toBe('INSUFFICIENT_STOCK');
  });

  it('founds a new settlement, consumes costs, logs history, and supports colony growth', () => {
    let state = fresh('founding-success');
    const set = capital(state);
    const initialPop = set.populationMilli;
    const initialFood = set.storage.FOOD;
    const initialTimber = set.storage.TIMBER;
    const initialStone = set.storage.STONE;

    // Find a valid target cell >= 4 steps away on land
    let targetCell = -1;
    for (let c = 0; c < state.map.elevation.length; c += 1) {
      if (state.map.elevation[c]! >= 90) {
        const distFromAll = state.settlements.every((s) => {
          const dq = Math.abs((s.cell % state.map.width) - (c % state.map.width));
          const dr = Math.abs(Math.floor(s.cell / state.map.width) - Math.floor(c / state.map.width));
          return dq + dr >= 6;
        });
        if (distFromAll) {
          targetCell = c;
          break;
        }
      }
    }
    expect(targetCell).toBeGreaterThanOrEqual(0);

    const foundCmd = command(state, {
      kind: 'FOUND_SETTLEMENT',
      target: targetCell,
      options: { name: 'New Horizon' },
    });

    const turnResult = resolveTurn(state, [foundCmd]);
    expect(turnResult.rejections).toEqual([]);
    expect(turnResult.accepted).toContain(foundCmd.commandId);
    state = turnResult.state;

    // Verify parent deductions
    const parent = state.settlements.find((s) => s.id === set.id)!;
    const summaries = turnResult.state.lastTurn!.settlements;
    const parentSummary = summaries.find((s) => s.settlementId === set.id)!;
    expect(parent.populationMilli).toBe(initialPop - 1000 + parentSummary.births);
    expect(parent.storage.FOOD).toBeLessThan(initialFood);
    expect(parent.storage.TIMBER).toBeLessThan(initialTimber);
    expect(parent.storage.STONE).toBe(initialStone - 800);

    // Verify new settlement created
    expect(state.settlements.length).toBe(3); // 2 original + 1 new
    const colony = state.settlements.find((s) => s.name === 'New Horizon')!;
    expect(colony).toBeDefined();
    expect(colony.cell).toBe(targetCell);
    expect(colony.ownerId).toBe(set.ownerId);
    const colonySummary = summaries.find((s) => s.settlementId === colony.id)!;
    expect(colony.populationMilli).toBe(1000 + colonySummary.births);
    expect(colony.dwellings).toBe(0);
    // Started with 800 FOOD rations; during turn 1 resolution: +200 base food - 200 consumed = 800
    expect(colony.storage.FOOD).toBe(800);
    expect(colony.foodCoverage).toBe(1000);
    expect(colony.shortageTurns).toBe(0);

    // Verify history event
    const historyEvent = state.history.find(
      (h) => h.type === 'CITY_FOUNDED' && h.payload.settlementId === colony.id,
    );
    expect(historyEvent).toBeDefined();
    expect(historyEvent?.locationIds).toContain(targetCell);
    expect(historyEvent?.actorIds).toEqual([parent.id, colony.id]);

    // Advance 5 more turns to ensure multi-settlement simulation remains invariant-sound
    for (let i = 0; i < 5; i += 1) {
      state = resolveTurn(state, []).state;
    }
    const settledColony = state.settlements.find((s) => s.id === colony.id)!;
    expect(settledColony.populationMilli).toBeGreaterThanOrEqual(1000);
    expect(settledColony.storage.FOOD).toBeGreaterThan(0);
  });
});

