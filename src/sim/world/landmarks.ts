// Dynamic Geographic Landmarks & World Memory (master Sections 13.1, 14.3, 16.5).
// Physical sites of historical events acquire persistent identity, reverence, and civic pilgrimage yields.

import type { CampaignState, Landmark, LandmarkKind, SettlementState } from '../core/state.ts';
import type { GodState } from '../gods/god.ts';
import { distance } from './hex.ts';

export interface NewLandmark {
  readonly cell: number;
  readonly name: string;
  readonly kind: LandmarkKind;
  readonly turn: number;
  readonly causeEventId: number;
  readonly creatorCivId: number | null;
  readonly description: string;
  readonly reverence?: number | undefined;
}

/** Creates and registers a new dynamic landmark in authoritative campaign state. */
export function createLandmark(state: CampaignState, params: NewLandmark): Landmark {
  const id = state.nextEntityId++;
  const landmark: Landmark = {
    id,
    cell: params.cell,
    name: params.name,
    kind: params.kind,
    turn: params.turn,
    causeEventId: params.causeEventId,
    creatorCivId: params.creatorCivId,
    description: params.description,
    reverence: params.reverence ?? 500,
  };
  state.landmarks.push(landmark);
  return landmark;
}

/** Returns all landmarks within wrapped hex distance of a given cell. */
export function getLandmarksNear(state: CampaignState, cell: number, maxDistance: number = 2): Landmark[] {
  return state.landmarks.filter((l) => distance(state.map, l.cell, cell) <= maxDistance);
}

/** Registers a founding hearth landmark when a settlement is established. */
export function registerFoundingLandmark(
  state: CampaignState,
  settlement: SettlementState,
  causeEventId: number,
): Landmark {
  return createLandmark(state, {
    cell: settlement.cell,
    name: `Hearth of ${settlement.name}`,
    kind: 'FOUNDING_HEARTH',
    turn: state.turn,
    causeEventId,
    creatorCivId: settlement.ownerId,
    description: `Founding hearth established in turn ${state.turn} by ${settlement.name}.`,
    reverence: 600,
  });
}

/** Registers a death site landmark when a colossal God perishes. */
export function registerDeathSiteLandmark(
  state: CampaignState,
  god: GodState,
  causeEventId: number,
): Landmark {
  return createLandmark(state, {
    cell: god.anchor,
    name: `Fallen Repose of God ${god.id}`,
    kind: 'DEATH_SITE',
    turn: state.turn,
    causeEventId,
    creatorCivId: god.ownerId,
    description: `The sacred site where God ${god.id} collapsed into the earth in turn ${state.turn}.`,
    reverence: 800,
  });
}

/** Registers an impact crater when a colossal strike violently shatters terrain. */
export function registerStrikeCraterLandmark(
  state: CampaignState,
  god: GodState,
  targetCell: number,
  causeEventId: number,
): Landmark | null {
  // Only create landmark if disturbance is significant (>= 500)
  if ((state.map.soilDisturbance[targetCell] as number) < 500) return null;

  return createLandmark(state, {
    cell: targetCell,
    name: `Sundered Vale of God ${god.id}`,
    kind: 'STRIKE_CRATER',
    turn: state.turn,
    causeEventId,
    creatorCivId: god.ownerId,
    description: `A fractured expanse blasted open by a divine impact from God ${god.id} in turn ${state.turn}.`,
    reverence: 300,
  });
}

/** Registers a sacred grove when a God cultivates and terraforms a parcel. */
export function registerSacredGroveLandmark(
  state: CampaignState,
  god: GodState,
  targetCell: number,
  causeEventId: number,
): Landmark {
  return createLandmark(state, {
    cell: targetCell,
    name: `Sacred Grove of God ${god.id}`,
    kind: 'SACRED_GROVE',
    turn: state.turn,
    causeEventId,
    creatorCivId: god.ownerId,
    description: `A flourishing, fertile biome revitalized through divine communion in turn ${state.turn}.`,
    reverence: 700,
  });
}

export interface LandmarkCivicBenefit {
  readonly legitimacyBonus: number;
  readonly pilgrimageCoinMilli: number;
}

/**
 * Calculates civic reverence and pilgrimage benefits for a settlement based on nearby landmarks.
 * Under P-PILGRIMAGE policy (Section 7.2), death sites and sacred groves attract real visitors,
 * earning trade tolls and donations for nearby markets and shrines.
 */
export function calculateLandmarkCivicBenefit(
  state: CampaignState,
  settlement: SettlementState,
): LandmarkCivicBenefit {
  const nearby = getLandmarksNear(state, settlement.cell, 2);
  let legitimacyBonus = 0;
  let pilgrimageCoinMilli = 0;

  const civ = state.civs.find((c) => c.id === settlement.ownerId);
  const isPilgrimagePolicy = civ?.policies?.CULTURAL_LEGITIMACY === 'P-PILGRIMAGE';

  for (const landmark of nearby) {
    if (landmark.kind === 'FOUNDING_HEARTH' || landmark.kind === 'SANCTUARY') {
      legitimacyBonus += 25;
    } else if (landmark.kind === 'SACRED_GROVE') {
      legitimacyBonus += 15;
      if (isPilgrimagePolicy) {
        pilgrimageCoinMilli += 100; // 1 whole COIN
      }
    } else if (landmark.kind === 'DEATH_SITE') {
      if (isPilgrimagePolicy) {
        // Section 7.2: Memorial pilgrimage visitors pay fees to local markets/shrines
        pilgrimageCoinMilli += 200; // 2 whole COIN
      }
    }
  }

  return {
    legitimacyBonus: Math.min(150, legitimacyBonus),
    pilgrimageCoinMilli,
  };
}
