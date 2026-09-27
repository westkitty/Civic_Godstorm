import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../src/sim/campaign.ts';
import { resolveTurn } from '../../src/sim/core/turn.ts';
import {
  calculateLandmarkCivicBenefit,
  createLandmark,
  getLandmarksNear,
  registerDeathSiteLandmark,
  registerSacredGroveLandmark,
  registerStrikeCraterLandmark,
} from '../../src/sim/world/landmarks.ts';
import { distance } from '../../src/sim/world/hex.ts';

describe('Dynamic Geographic Landmarks (master Sections 13.1, 14.3, 16.5)', () => {
  it('creates and retrieves landmarks by spatial proximity', () => {
    const campaign = createCampaign({ seed: 'landmark-test', size: 'small', civCount: 2 });
    const cell = 25;

    const lm = createLandmark(campaign, {
      cell,
      name: 'Shrine of the First Dawn',
      kind: 'SANCTUARY',
      turn: 1,
      causeEventId: 1,
      creatorCivId: campaign.civs[0]!.id,
      description: 'An ancient sanctuary erected in early memory.',
      reverence: 750,
    });

    expect(lm.id).toBeGreaterThan(0);
    expect(campaign.landmarks).toContainEqual(lm);

    const near = getLandmarksNear(campaign, cell, 2);
    expect(near.map((l) => l.id)).toContain(lm.id);

    // Far cell should not include this landmark
    const far = getLandmarksNear(campaign, (cell + 50) % (campaign.map.width * campaign.map.height), 1);
    expect(far.map((l) => l.id)).not.toContain(lm.id);
  });

  it('registers death site and sacred grove landmarks through God actions', () => {
    const campaign = createCampaign({ seed: 'landmark-test', size: 'small', civCount: 2 });
    const god = campaign.gods[0]!;

    // 1. Sacred Grove via GOD_CULTIVATE
    const groveLm = registerSacredGroveLandmark(campaign, god, god.anchor, 10);
    expect(groveLm.kind).toBe('SACRED_GROVE');
    expect(groveLm.cell).toBe(god.anchor);
    expect(campaign.landmarks).toContainEqual(groveLm);

    // 2. Strike Crater via GOD_STRIKE on disturbed terrain
    campaign.map.soilDisturbance[god.anchor] = 600;
    const craterLm = registerStrikeCraterLandmark(campaign, god, god.anchor, 11);
    expect(craterLm).not.toBeNull();
    expect(craterLm?.kind).toBe('STRIKE_CRATER');

    // 3. Death Site via God death
    const deathLm = registerDeathSiteLandmark(campaign, god, 12);
    expect(deathLm.kind).toBe('DEATH_SITE');
    expect(deathLm.reverence).toBe(800);
  });

  it('grants reverence legitimacy and pilgrimage coin under P-PILGRIMAGE policy', () => {
    const campaign = createCampaign({ seed: 'landmark-test', size: 'small', civCount: 2 });
    const settlement = campaign.settlements[0]!;
    const civ = campaign.civs.find((c) => c.id === settlement.ownerId)!;

    // Place a death site landmark adjacent to the settlement
    registerDeathSiteLandmark(campaign, campaign.gods[0]!, 1);

    // Baseline benefits without pilgrimage policy
    const baseBenefits = calculateLandmarkCivicBenefit(campaign, settlement);
    expect(baseBenefits.pilgrimageCoinMilli).toBe(0);

    // Adopt P-PILGRIMAGE policy
    civ.policies.CULTURAL_LEGITIMACY = 'P-PILGRIMAGE';
    const pilgrimBenefits = calculateLandmarkCivicBenefit(campaign, settlement);
    expect(pilgrimBenefits.pilgrimageCoinMilli).toBeGreaterThan(0);

    // Run settlement turn and verify coin ledger credit
    const coinBefore = civ.coin;
    const turnRes = resolveTurn(campaign, []);
    const updatedCiv = turnRes.state.civs.find((c) => c.id === civ.id)!;
    expect(updatedCiv.coin).toBeGreaterThan(coinBefore);
  });

  it('registers founding hearth landmark when founding new settlement', () => {
    const campaign = createCampaign({ seed: 'landmark-test', size: 'small', civCount: 2 });
    const parentSettlement = campaign.settlements[0]!;
    const civ = campaign.civs.find((c) => c.id === parentSettlement.ownerId)!;

    // Find valid settlement cell: land, distance >= 3 from all settlements, distance <= 5 from parent
    let targetCell = -1;
    for (let c = 0; c < campaign.map.elevation.length; c += 1) {
      if ((campaign.map.elevation[c] ?? 0) >= 90) {
        const distFromAll = campaign.settlements.every((s) => distance(campaign.map, s.cell, c) >= 3);
        const distFromParent = distance(campaign.map, parentSettlement.cell, c);
        if (distFromAll && distFromParent <= 5) {
          targetCell = c;
          break;
        }
      }
    }
    expect(targetCell).toBeGreaterThanOrEqual(0);

    parentSettlement.populationMilli = 3000;
    parentSettlement.storage.FOOD = 2000;
    parentSettlement.storage.TIMBER = 2000;
    parentSettlement.storage.STONE = 2000;

    const foundCmd = {
      commandId: `${civ.id}:1:1`,
      civId: civ.id,
      issuedForTurn: 1,
      expectedStateVersion: 0,
      sequence: 1,
      kind: 'FOUND_SETTLEMENT' as const,
      actorId: parentSettlement.id,
      target: targetCell,
      options: { targetCell, name: 'Colony Prime' },
      consent: {},
    };

    const res = resolveTurn(campaign, [foundCmd]);
    expect(res.accepted).toContain(foundCmd.commandId);

    const colonyLandmark = res.state.landmarks.find((l) => l.cell === targetCell && l.kind === 'FOUNDING_HEARTH');
    expect(colonyLandmark).toBeDefined();
    expect(colonyLandmark?.name).toContain('Colony Prime');
  });
});
