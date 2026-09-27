// God anatomical wounding, regional health, and scar history (master Sections 4.6, 4.7, 16.5).
// Five body regions: vital core, locomotor structures, feeding apparatus, sensory structures, defensive structures.
// Five wound types: BRUISE, TEAR, FRACTURE, INFECTION, LOST_STRUCTURE.

import type { CampaignState } from '../core/state.ts';
import { cellsWithin } from '../world/hex.ts';
import type { GodState, RegionHealth } from './god.ts';

export type BodyRegion = keyof RegionHealth; // 'core' | 'locomotor' | 'feeding' | 'sensory' | 'defensive'
export type WoundType = 'BRUISE' | 'TEAR' | 'FRACTURE' | 'INFECTION' | 'LOST_STRUCTURE';

export interface Wound {
  readonly id: number;
  readonly type: WoundType;
  readonly region: BodyRegion;
  severity: 1 | 2 | 3;
  readonly turnInflicted: number;
  readonly cause: string;
  treatedTurns: number;
}

export interface Scar {
  readonly id: number;
  readonly region: BodyRegion;
  readonly description: string;
  readonly turnFormed: number;
}

/** Section 4.7: Checks if God has a locomotor fracture or severe locomotor damage. */
export function hasLocomotorImpairment(god: GodState): boolean {
  if (god.regionHealth.locomotor <= 200) return true;
  return god.wounds.some((w) => w.region === 'locomotor' && (w.type === 'FRACTURE' || w.type === 'LOST_STRUCTURE'));
}

/** Section 4.7: Checks if God has sensory damage reducing sight radius. */
export function hasSensoryImpairment(god: GodState): boolean {
  if (god.regionHealth.sensory <= 200) return true;
  return god.wounds.some((w) => w.region === 'sensory');
}

/** Section 4.7: Checks if feeding apparatus is damaged, reducing food conversion. */
export function hasFeedingImpairment(god: GodState): boolean {
  if (god.regionHealth.feeding <= 200) return true;
  return god.wounds.some((w) => w.region === 'feeding');
}

/**
 * Inflicts a regional anatomical wound on a God with structural penalties and trust impact.
 */
export function inflictWound(
  god: GodState,
  region: BodyRegion,
  type: WoundType,
  severity: 1 | 2 | 3,
  cause: string,
  turn: number,
): Wound {
  const woundId = god.wounds.length + god.scars.length + 1;
  const wound: Wound = {
    id: woundId,
    type,
    region,
    severity,
    turnInflicted: turn,
    cause,
    treatedTurns: 0,
  };
  god.wounds.push(wound);

  // Regional and vital damage
  const damage = severity * 25;
  god.regionHealth[region] = Math.max(0, god.regionHealth[region] - damage);
  god.vitalHealth = Math.max(0, god.vitalHealth - severity * 20);

  // Section 4.7: Injuries impact follower trust
  god.trust = Math.max(0, god.trust - severity * 20);

  return wound;
}

export interface MedicalCareResult {
  hasInfirmaryCare: boolean;
  consumedMedicine: boolean;
}

/**
 * Checks if a resting God receives medical care from a nearby settlement infirmary with medicine.
 * Consumes 1 unit of MEDICINE (100 quantity) if available.
 */
export function applyMedicalCare(state: CampaignState, god: GodState): MedicalCareResult {
  const civSettlements = state.settlements.filter((s) => s.ownerId === god.ownerId);
  for (const settlement of civSettlements) {
    if (settlement.buildings?.infirmary > 0) {
      const nearby = cellsWithin(state.map, settlement.cell, 2);
      if (nearby.includes(god.anchor)) {
        if ((settlement.storage?.MEDICINE ?? 0) >= 100) {
          settlement.storage.MEDICINE -= 100;
          return { hasInfirmaryCare: true, consumedMedicine: true };
        }
        return { hasInfirmaryCare: true, consumedMedicine: false };
      }
    }
  }
  return { hasInfirmaryCare: false, consumedMedicine: false };
}

/**
 * Section 4.6 & 4.7: Resolves wound healing during a fed rest turn.
 * Bruises heal quickly; tears and fractures require medicine and leave scars.
 */
export function progressWoundHealing(god: GodState, turn: number, medicalCare: MedicalCareResult): { healed: Wound[]; newScars: Scar[] } {
  const remainingWounds: Wound[] = [];
  const healed: Wound[] = [];
  const newScars: Scar[] = [];

  for (const wound of god.wounds) {
    // Medical care doubles treatment progression
    wound.treatedTurns += medicalCare.consumedMedicine ? 2 : 1;

    let isHealed = false;
    let leavesScar = false;

    switch (wound.type) {
      case 'BRUISE':
        if (wound.treatedTurns >= 2) isHealed = true;
        break;
      case 'TEAR':
        if (wound.treatedTurns >= 3) {
          isHealed = true;
          leavesScar = true;
        }
        break;
      case 'FRACTURE':
        // Fractures require medicine to heal completely
        if (wound.treatedTurns >= 4 && medicalCare.consumedMedicine) {
          isHealed = true;
          leavesScar = true;
        }
        break;
      case 'INFECTION':
        if (wound.treatedTurns >= 3 && medicalCare.consumedMedicine) {
          isHealed = true;
        }
        break;
      case 'LOST_STRUCTURE':
        // Section 4.7: Regrowth permitted only for sensory fronds/membranes with 4 fed rest turns + medicine
        if (wound.region === 'sensory' && wound.treatedTurns >= 4 && medicalCare.consumedMedicine) {
          isHealed = true;
          leavesScar = true;
        }
        break;
    }

    if (isHealed) {
      healed.push(wound);
      if (leavesScar) {
        const scar: Scar = {
          id: god.scars.length + 1,
          region: wound.region,
          description: `Healed ${wound.type.toLowerCase()} on ${wound.region} (${wound.cause})`,
          turnFormed: turn,
        };
        god.scars.push(scar);
        newScars.push(scar);
      }
    } else {
      remainingWounds.push(wound);
    }
  }

  god.wounds = remainingWounds;
  return { healed, newScars };
}
