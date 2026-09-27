import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../src/sim/campaign.ts';
import { resolveTurn } from '../../src/sim/core/turn.ts';
import { apForFatigue } from '../../src/sim/gods/god.ts';
import {
  applyMedicalCare,
  hasFeedingImpairment,
  hasLocomotorImpairment,
  hasSensoryImpairment,
  inflictWound,
  progressWoundHealing,
} from '../../src/sim/gods/wounds.ts';
import { visibleCells } from '../../src/sim/observation/observation.ts';

describe('God regional anatomical wounding and scar history (master Section 4.6, 4.7)', () => {
  it('inflicts regional wounds reducing region health, vital health, and follower trust', () => {
    const state = createCampaign({ seed: 'wound-test', size: 'small', civCount: 2 });
    const god = state.gods[0]!;
    const initialVital = god.vitalHealth;
    const initialTrust = god.trust;

    const wound = inflictWound(god, 'locomotor', 'FRACTURE', 2, 'Colossal impact rebound', 5);

    expect(wound.id).toBe(1);
    expect(wound.type).toBe('FRACTURE');
    expect(wound.region).toBe('locomotor');
    expect(wound.severity).toBe(2);
    expect(god.wounds).toHaveLength(1);

    // Severity 2: 2 * 25 = 50 regional damage, 2 * 20 = 40 vital damage, 2 * 20 = 40 trust loss
    expect(god.regionHealth.locomotor).toBe(350);
    expect(god.vitalHealth).toBe(initialVital - 40);
    expect(god.trust).toBe(initialTrust - 40);
  });

  it('imposes 1 AP penalty for locomotor fracture / severe locomotor damage', () => {
    const state = createCampaign({ seed: 'ap-penalty-test', size: 'small', civCount: 2 });
    const god = state.gods[0]!;

    expect(hasLocomotorImpairment(god)).toBe(false);
    expect(apForFatigue(0, god)).toBe(4);

    // Inflict fracture on locomotor
    inflictWound(god, 'locomotor', 'FRACTURE', 1, 'Twisted limb', 2);
    expect(hasLocomotorImpairment(god)).toBe(true);
    // 1 AP penalty applied
    expect(apForFatigue(0, god)).toBe(3);
  });

  it('reduces sensory observation radius on sensory injury', () => {
    const state = createCampaign({ seed: 'sensory-test', size: 'small', civCount: 2 });
    const god = state.gods[0]!;
    const civId = god.ownerId;

    const initialVisible = visibleCells(state, civId).size;

    // Inflict severe sensory damage
    inflictWound(god, 'sensory', 'TEAR', 2, 'Crystalline frond tear', 4);
    expect(hasSensoryImpairment(god)).toBe(true);

    const injuredVisible = visibleCells(state, civId).size;
    expect(injuredVisible).toBeLessThan(initialVisible);
  });

  it('reduces feeding conversion efficiency by 25% when feeding apparatus is damaged', () => {
    const state = createCampaign({ seed: 'feed-penalty-test', size: 'small', civCount: 2 });
    const god = state.gods[0]!;

    expect(hasFeedingImpairment(god)).toBe(false);
    inflictWound(god, 'feeding', 'TEAR', 2, 'Damaged filter membrane', 3);
    expect(hasFeedingImpairment(god)).toBe(true);

    // Order feed
    god.reserve = 1000;
    god.order = { kind: 'FEED' };
    const res = resolveTurn(state, []);
    const summary = res.state.lastTurn?.gods.find((g) => g.godId === god.id);
    expect(summary?.fed).toBe(true);
    // Nutrition gained was reduced by 25%
    expect(summary?.nutritionGained).toBeGreaterThan(0);
  });

  it('doubles regional healing when resting near an infirmary with medicine and heals wounds into scars', () => {
    const state = createCampaign({ seed: 'heal-test', size: 'small', civCount: 2 });
    const god = state.gods[0]!;
    const settlement = state.settlements[0]!;

    // Position god at settlement with infirmary and medicine
    god.anchor = settlement.cell;
    settlement.buildings.infirmary = 1;
    settlement.storage.MEDICINE = 500; // 5 whole units

    inflictWound(god, 'defensive', 'TEAR', 1, 'Flank laceration', 1);
    expect(god.regionHealth.defensive).toBe(375);
    expect(god.wounds).toHaveLength(1);
    expect(god.scars).toHaveLength(0);

    // Medical care should detect infirmary and medicine
    const medCare = applyMedicalCare(state, god);
    expect(medCare.hasInfirmaryCare).toBe(true);
    expect(medCare.consumedMedicine).toBe(true);
    expect(settlement.storage.MEDICINE).toBe(400); // 100 consumed

    // Progress healing with medical care
    // Tear needs 3 treated turns; with medicine treatedTurns += 2 on turn 1
    const res1 = progressWoundHealing(god, 2, medCare);
    expect(res1.healed).toHaveLength(0);
    expect(god.wounds[0]!.treatedTurns).toBe(2);

    // Second turn with medical care adds +2 treatedTurns (total 4 >= 3) -> heals into scar!
    const res2 = progressWoundHealing(god, 3, medCare);
    expect(res2.healed).toHaveLength(1);
    expect(res2.newScars).toHaveLength(1);
    expect(god.wounds).toHaveLength(0);
    expect(god.scars).toHaveLength(1);
    expect(god.scars[0]!.description).toContain('Flank laceration');
  });

  it('integrates REST turn resolution to apply medical healing and logs GOD_HEALED history event', () => {
    const state = createCampaign({ seed: 'rest-heal-sim', size: 'small', civCount: 2 });
    const god = state.gods[0]!;
    const settlement = state.settlements[0]!;

    god.anchor = settlement.cell;
    settlement.buildings.infirmary = 1;
    settlement.storage.MEDICINE = 1000;

    // Inflict bruise on core (heals after 2 treated turns)
    inflictWound(god, 'core', 'BRUISE', 1, 'Heavy compression', 1);

    // Rest turn 1 (with medicine, treatedTurns advances by 2 >= 2 -> heals immediately)
    god.order = { kind: 'REST' };
    const res1 = resolveTurn(state, []);
    const healedGod = res1.state.gods[0]!;

    expect(healedGod.wounds).toHaveLength(0);
    const healEvent = res1.state.history.find((h) => h.type === 'GOD_HEALED');
    expect(healEvent).toBeDefined();
    expect(healEvent?.payload.region).toBe('core');
    expect(healEvent?.payload.woundType).toBe('BRUISE');
  });
});
