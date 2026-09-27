import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../src/sim/campaign.ts';
import { resolveTurn } from '../../src/sim/core/turn.ts';
import {
  defoliationStageFor,
  effectiveFertility,
  isCompacted,
  recoverSoil,
  regenerateEcologyWithSoil,
  ECOLOGY_RULES,
} from '../../src/sim/world/ecology.ts';

describe('Reactive Ecology, Soil Degradation & Healing', () => {
  it('calculates effective fertility scaling with soil disturbance', () => {
    const campaign = createCampaign({ seed: 'eco-test', size: 'small', civCount: 2 });
    const cell = 10;
    campaign.map.fertility[cell] = 800;
    campaign.map.soilDisturbance[cell] = 0;

    // Disturbance 0 -> 100% fertility
    expect(effectiveFertility(campaign.map, cell)).toBe(800);

    // Disturbance 500 -> 75% fertility
    campaign.map.soilDisturbance[cell] = 500;
    expect(effectiveFertility(campaign.map, cell)).toBe(600);

    // Disturbance 1000 -> 50% fertility
    campaign.map.soilDisturbance[cell] = 1000;
    expect(effectiveFertility(campaign.map, cell)).toBe(400);
  });

  it('classifies compaction and defoliation stages accurately', () => {
    const campaign = createCampaign({ seed: 'eco-test', size: 'small', civCount: 2 });
    const cell = 15;

    campaign.map.soilDisturbance[cell] = 499;
    expect(isCompacted(campaign.map, cell)).toBe(false);

    campaign.map.soilDisturbance[cell] = 500;
    expect(isCompacted(campaign.map, cell)).toBe(true);

    const capacity = 1000;
    expect(defoliationStageFor(900, capacity)).toBe('PRISTINE');
    expect(defoliationStageFor(500, capacity)).toBe('HARVESTED');
    expect(defoliationStageFor(250, capacity)).toBe('DEPLETED');
    expect(defoliationStageFor(100, capacity)).toBe('BARREN');
  });

  it('heals soil disturbance over multiple turns on undisturbed resting cells', () => {
    const campaign = createCampaign({ seed: 'eco-test', size: 'small', civCount: 2 });
    const cell = 20;
    campaign.map.soilDisturbance[cell] = 100;

    // Turn 1 recovery
    const recovered = recoverSoil(campaign);
    expect(recovered).toBeGreaterThanOrEqual(1);
    expect(campaign.map.soilDisturbance[cell]).toBe(75); // 100 - 25

    // Turn 2 recovery
    recoverSoil(campaign);
    expect(campaign.map.soilDisturbance[cell]).toBe(50);

    // Turn 3 recovery
    recoverSoil(campaign);
    expect(campaign.map.soilDisturbance[cell]).toBe(25);

    // Turn 4 recovery
    recoverSoil(campaign);
    expect(campaign.map.soilDisturbance[cell]).toBe(0);
  });

  it('accelerates soil recovery under P-STEWARDSHIP policy', () => {
    const campaign = createCampaign({ seed: 'eco-test', size: 'small', civCount: 2 });
    const settlement = campaign.settlements[0]!;
    const nearCell = settlement.cell; // right next to settlement

    campaign.map.soilDisturbance[nearCell] = 100;

    // Normal recovery without policy: 25/turn
    recoverSoil(campaign);
    expect(campaign.map.soilDisturbance[nearCell]).toBe(75);

    // Adopt P-STEWARDSHIP policy
    const civ = campaign.civs.find((c) => c.id === settlement.ownerId)!;
    civ.policies.RESOURCE_ETHICS = 'P-STEWARDSHIP';

    // With P-STEWARDSHIP: base 25 + bonus 25 = 50/turn
    recoverSoil(campaign);
    expect(campaign.map.soilDisturbance[nearCell]).toBe(25); // 75 - 50 = 25
  });

  it('penalizes vegetation regeneration on compacted soil', () => {
    const campaign = createCampaign({ seed: 'eco-test', size: 'small', civCount: 2 });
    const cellA = 30; // healthy soil
    const cellB = 31; // compacted soil

    // Set identical grassland biome, capacity, and current biomass
    campaign.map.biome[cellA] = 2; // GRASSLAND
    campaign.map.biome[cellB] = 2;
    campaign.map.biomassCapacity[cellA] = 800;
    campaign.map.biomassCapacity[cellB] = 800;
    campaign.map.biomass[cellA] = 400;
    campaign.map.biomass[cellB] = 400;

    campaign.map.soilDisturbance[cellA] = 0;
    campaign.map.soilDisturbance[cellB] = ECOLOGY_RULES.compactionThreshold;

    regenerateEcologyWithSoil(campaign);

    // Healthy cell gains more biomass than compacted cell
    const gainA = (campaign.map.biomass[cellA] ?? 0) - 400;
    const gainB = (campaign.map.biomass[cellB] ?? 0) - 400;
    expect(gainA).toBeGreaterThan(gainB);
  });

  it('penalizes settlement farm yield when farm parcels are compacted', () => {
    const campaign = createCampaign({ seed: 'eco-test', size: 'small', civCount: 2 });
    const settlement = campaign.settlements[0]!;

    // Ensure settlement has a farm site
    if (settlement.farmSites.length === 0) {
      settlement.farmSites.push({ cell: settlement.cell + 1 });
    }
    const farmCell = settlement.farmSites[0]!.cell;
    campaign.map.fertility[farmCell] = 800;
    campaign.map.soilDisturbance[farmCell] = 0;

    // Normal farm run
    const resultNormal = resolveTurn(campaign, []);
    const foodNormal = resultNormal.state.lastTurn?.settlements.find((s) => s.settlementId === settlement.id)?.produced.FOOD ?? 0;

    // Repeat with compacted farm soil
    const campaignCompacted = createCampaign({ seed: 'eco-test', size: 'small', civCount: 2 });
    const settCompacted = campaignCompacted.settlements[0]!;
    if (settCompacted.farmSites.length === 0) {
      settCompacted.farmSites.push({ cell: settCompacted.cell + 1 });
    }
    const farmCellCompacted = settCompacted.farmSites[0]!.cell;
    campaignCompacted.map.fertility[farmCellCompacted] = 800;
    campaignCompacted.map.soilDisturbance[farmCellCompacted] = 800; // severe compaction

    const resultCompacted = resolveTurn(campaignCompacted, []);
    const foodCompacted = resultCompacted.state.lastTurn?.settlements.find((s) => s.settlementId === settlement.id)?.produced.FOOD ?? 0;

    expect(foodCompacted).toBeLessThan(foodNormal);
    const summary = resultCompacted.state.lastTurn?.settlements.find((s) => s.settlementId === settlement.id);
    expect(summary?.warnings).toContain('FARM_SOIL_COMPACTED');
  });

  it('restores soil disturbance and biomass through God CULTIVATE order', () => {
    const campaign = createCampaign({ seed: 'eco-test', size: 'small', civCount: 2 });
    const god = campaign.gods[0]!;
    const targetCell = god.anchor;

    campaign.map.soilDisturbance[targetCell] = 600;
    campaign.map.biomassCapacity[targetCell] = 800;
    campaign.map.biomass[targetCell] = 300;

    const cultivateCmd = {
      commandId: `${god.ownerId}:1:1`,
      civId: god.ownerId,
      issuedForTurn: 1,
      expectedStateVersion: 0,
      sequence: 1,
      kind: 'GOD_CULTIVATE' as const,
      actorId: god.id,
      target: targetCell,
      options: { targetCell, adaptation: 'NONE' },
      consent: {},
    };

    const res = resolveTurn(campaign, [cultivateCmd]);
    expect(res.accepted).toContain(cultivateCmd.commandId);

    // Soil disturbance should be reduced by 400 (600 - 400 = 200)
    expect(res.state.map.soilDisturbance[targetCell]).toBe(200);
    // Biomass should be increased by 200 (300 + 200 = 500)
    expect(res.state.map.biomass[targetCell]).toBeGreaterThanOrEqual(500);
  });
});
