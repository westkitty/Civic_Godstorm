// God lifecycle, continuous aging, and longevity mechanics (master Section 4.7).
// Young: 0-59 turns, Mature: 60-159 turns, Ancient: 160+ turns.
// Ancient Gods suffer chronic integrity loss (5 vital health/turn) unless protected
// by 5 or more longevity support from medical services, adaptations, and technologies.

import type { CampaignState, SettlementState } from '../core/state.ts';
import { cellsWithin, type MapDimensions } from '../world/hex.ts';
import type { GodState } from './god.ts';

export type AgeBracket = 'YOUNG' | 'MATURE' | 'ANCIENT';

export const AGE_RULES = {
  youngMax: 59,
  matureMax: 159,
  ancientMin: 160,
  warningHorizon: 20,
  baseChronicLoss: 5,
  maxLongevitySupport: 5,
} as const;

export function ageBracketFor(age: number): AgeBracket {
  if (age <= AGE_RULES.youngMax) return 'YOUNG';
  if (age <= AGE_RULES.matureMax) return 'MATURE';
  return 'ANCIENT';
}

/** Section 4.7: The UI warns twenty turns before the Ancient threshold (turns 140..159). */
export function isAgingWarningActive(age: number): boolean {
  return age >= AGE_RULES.ancientMin - AGE_RULES.warningHorizon && age < AGE_RULES.ancientMin;
}

export function turnsUntilAncient(age: number): number {
  return Math.max(0, AGE_RULES.ancientMin - age);
}

/**
 * Calculates available longevity support (capped at 5) for a God based on settlement medical
 * infrastructure, proximity to infirmaries, medicine reserves, and biological/vital knowledge.
 */
export function calculateLongevitySupport(
  settlements: readonly SettlementState[],
  dims: MapDimensions,
  godAnchor: number,
  completedTechs: readonly string[] = [],
): number {
  let support = 0;

  // 1. Settlement medical infrastructure: completed infirmaries
  let totalInfirmaries = 0;
  let hasNearbyInfirmary = false;
  for (const s of settlements) {
    const inf = s.buildings?.infirmary ?? 0;
    if (inf > 0) {
      totalInfirmaries += inf;
      if (!hasNearbyInfirmary) {
        const nearby = cellsWithin(dims, s.cell, 2);
        if (nearby.includes(godAnchor)) {
          hasNearbyInfirmary = true;
        }
      }
    }
  }
  support += totalInfirmaries;
  // Dedicated proximity care bonus
  if (hasNearbyInfirmary) support += 1;

  // 2. Medicinal stocks: at least 10 whole medicine units stored in civ settlements
  const totalMedicineUnits = settlements.reduce((sum, s) => sum + Math.floor((s.storage?.MEDICINE ?? 0) / 100), 0);
  if (totalMedicineUnits >= 10) support += 1;

  // 3. Biomedical / physiological technologies
  if (completedTechs.includes('T-ECO-2')) support += 1; // Herbalism / pharmacology
  if (completedTechs.includes('T-ANA-3')) support += 1; // Cellular / vital theory
  if (completedTechs.includes('T-ECO-3')) support += 1; // Ecological / biological husbandry

  return Math.min(AGE_RULES.maxLongevitySupport, support);
}

/** Helper evaluating longevity support directly from CampaignState. */
export function calculateGodLongevitySupport(state: CampaignState, god: GodState): number {
  const civSettlements = state.settlements.filter((s) => s.ownerId === god.ownerId);
  const civ = state.civs.find((c) => c.id === god.ownerId);
  return calculateLongevitySupport(civSettlements, state.map, god.anchor, civ?.completedTechs ?? []);
}

/**
 * Section 4.7: Chronic integrity decay per turn for Ancient Gods.
 * Returns vital health loss (0..5). Returns 0 if younger than Ancient (age < 160)
 * or if longevity support >= 5.
 */
export function chronicIntegrityLoss(state: CampaignState, god: GodState): number {
  if (god.age < AGE_RULES.ancientMin) return 0;
  const support = calculateGodLongevitySupport(state, god);
  return Math.max(0, AGE_RULES.baseChronicLoss - support);
}
