import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../src/sim/campaign.ts';
import { resolveTurn } from '../../src/sim/core/turn.ts';
import {
  ageBracketFor,
  calculateGodLongevitySupport,
  calculateLongevitySupport,
  chronicIntegrityLoss,
  isAgingWarningActive,
  turnsUntilAncient,
} from '../../src/sim/gods/lifecycle.ts';

describe('God aging and lifecycle progression (master Section 4.7)', () => {
  it('correctly classifies age brackets across threshold boundaries', () => {
    expect(ageBracketFor(0)).toBe('YOUNG');
    expect(ageBracketFor(59)).toBe('YOUNG');
    expect(ageBracketFor(60)).toBe('MATURE');
    expect(ageBracketFor(159)).toBe('MATURE');
    expect(ageBracketFor(160)).toBe('ANCIENT');
    expect(ageBracketFor(250)).toBe('ANCIENT');
  });

  it('triggers the 20-turn aging warning between turns 140 and 159', () => {
    expect(isAgingWarningActive(139)).toBe(false);
    expect(isAgingWarningActive(140)).toBe(true);
    expect(isAgingWarningActive(150)).toBe(true);
    expect(isAgingWarningActive(159)).toBe(true);
    expect(isAgingWarningActive(160)).toBe(false);

    expect(turnsUntilAncient(140)).toBe(20);
    expect(turnsUntilAncient(155)).toBe(5);
    expect(turnsUntilAncient(160)).toBe(0);
  });

  it('calculates longevity support from infirmaries, proximity, medicine, and tech', () => {
    const dims = { width: 48, height: 32 };
    const godAnchor = 100;

    // 0 support initially
    expect(calculateLongevitySupport([], dims, godAnchor)).toBe(0);

    // 1 distant infirmary: +1 support
    const distantSettlement = {
      id: 1,
      ownerId: 0,
      cell: 500,
      name: 'Far',
      originalCapitalOf: 0,
      populationMilli: 2000,
      dwellings: 2,
      buildings: { granary: 0, workshop: 0, depot: 0, archive: 0, infirmary: 1 },
      hallIntegrity: 1000,
      farmSites: [],
      jobs: { farm: 500, forestry: 500, quarry: 500, builder: 500 },
      storage: { FOOD: 50, TIMBER: 50, STONE: 50, ORE: 0, TOOLS: 0, MEDICINE: 0, BIO: 0 },
      carry: {},
      queue: [],
      welfare: 500,
      foodCoverage: 100,
      shortageTurns: 0,
      legitimacy: 500,
    };
    expect(calculateLongevitySupport([distantSettlement], dims, godAnchor)).toBe(1);

    // Close infirmary at cell 101 (within 2 hexes of 100): +1 (building) + 1 (proximity) = 2
    const closeSettlement = {
      ...distantSettlement,
      cell: 101,
      storage: { ...distantSettlement.storage, MEDICINE: 1200 }, // +1 for medicine stock >= 10 whole units
    };
    // 1 building + 1 proximity + 1 medicine = 3
    expect(calculateLongevitySupport([closeSettlement], dims, godAnchor)).toBe(3);

    // With biomedical tech T-ECO-2 and T-ANA-3: 3 + 2 = 5 (capped at 5)
    expect(calculateLongevitySupport([closeSettlement], dims, godAnchor, ['T-ECO-2', 'T-ANA-3'])).toBe(5);

    // Excess support is capped at 5
    expect(calculateLongevitySupport([closeSettlement], dims, godAnchor, ['T-ECO-2', 'T-ANA-3', 'T-ECO-3'])).toBe(5);
  });

  it('arrests chronic integrity decay when longevity support reaches 5, otherwise applies (5 - support)', () => {
    const state = createCampaign({ seed: 'aging-test', size: 'small', civCount: 2 });
    const god = state.gods[0]!;

    // Young god: no decay
    god.age = 30;
    expect(chronicIntegrityLoss(state, god)).toBe(0);

    // Mature god: no decay
    god.age = 100;
    expect(chronicIntegrityLoss(state, god)).toBe(0);

    // Ancient god with 0 longevity support: 5 decay per turn
    god.age = 160;
    expect(calculateGodLongevitySupport(state, god)).toBe(0);
    expect(chronicIntegrityLoss(state, god)).toBe(5);

    // Add 2 infirmaries: 2 (buildings) + 1 (proximity care since God starts near capital) = 3 support -> 2 decay
    state.settlements[0]!.buildings.infirmary = 2;
    expect(calculateGodLongevitySupport(state, god)).toBe(3);
    expect(chronicIntegrityLoss(state, god)).toBe(2);

    // Position god close to infirmary (at settlement cell) and add medicine: support hits 5 -> 0 decay
    god.anchor = state.settlements[0]!.cell;
    state.settlements[0]!.storage.MEDICINE = 2000;
    state.civs[0]!.completedTechs.push('T-ECO-2', 'T-ANA-3');
    expect(calculateGodLongevitySupport(state, god)).toBe(5);
    expect(chronicIntegrityLoss(state, god)).toBe(0);
  });

  it('records GOD_AGED history events when transitioning brackets and applies chronic decay', () => {
    const state = createCampaign({ seed: 'aging-sim', size: 'small', civCount: 2 });
    const god = state.gods[0]!;

    // Position god at age 59 (turn ending will make age 60: YOUNG -> MATURE)
    god.age = 59;
    const res1 = resolveTurn(state, []);
    const agedEvent1 = res1.state.history.find((h) => h.type === 'GOD_AGED');
    expect(agedEvent1).toBeDefined();
    expect(agedEvent1?.payload.bracket).toBe('MATURE');
    expect(agedEvent1?.payload.age).toBe(60);

    // Position god at age 159 (turn ending will make age 160: MATURE -> ANCIENT)
    res1.state.gods[0]!.age = 159;
    const initialHealth = res1.state.gods[0]!.vitalHealth;
    const res2 = resolveTurn(res1.state, []);
    const agedEvent2 = res2.state.history.filter((h) => h.type === 'GOD_AGED').at(-1);
    expect(agedEvent2).toBeDefined();
    expect(agedEvent2?.payload.bracket).toBe('ANCIENT');
    expect(agedEvent2?.payload.age).toBe(160);

    // With 0 longevity support, vital health must decay by 5
    expect(res2.state.gods[0]!.vitalHealth).toBe(initialHealth - 5);
  });
});
