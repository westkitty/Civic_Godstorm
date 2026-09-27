// Reactive ecology, soil degradation, compaction, defoliation and multi-turn healing
// (master Sections 3.2, 4.6, 5.1, 16.4). All quantities integer/fixed-point (0..1000).

import type { CampaignState, MapState } from '../core/state.ts';
import { BIOME_RULES, BIOMES, type Biome } from '../data/rules.ts';
import { occupiedCells } from '../gods/body.ts';
import { sizeRules, type GodState } from '../gods/god.ts';
import { distance } from './hex.ts';

export const ECOLOGY_RULES = {
  /** Natural soil recovery per turn on resting cells (0..1000 scale). */
  baseSoilRecoveryRate: 25,
  /** Soil disturbance at or above this threshold is compacted, reducing fertility and vegetation recovery. */
  compactionThreshold: 500,
  /** Severe compaction threshold. */
  severeCompactionThreshold: 800,
  /** Percentage reduction in vegetation regeneration rate on compacted soil. */
  compactionRegenPenaltyPercent: 50,
  /** Extra soil recovery per turn under P-STEWARDSHIP policy within stewardship zone. */
  stewardshipRecoveryBonus: 25,
  /** Extra soil recovery per turn with T-ECO-2 (Biogeochemical Cycles) or T-ECO-3. */
  techEcologyRecoveryBonus: 15,
  /** Disturbance threshold where unreinforced road infrastructure is crushed by heavy Gods. */
  roadDestructionDisturbance: 750,
  /** God mass threshold capable of crushing roads during heavy passage. */
  roadDestructionMass: 20,
} as const;

/** Section 3.2 / 16.4: Effective fertility accounts for soil disturbance and compaction. */
export function effectiveFertility(map: MapState, cell: number): number {
  const base = map.fertility[cell] as number;
  const disturbance = map.soilDisturbance[cell] as number;
  if (disturbance <= 0) return base;
  // Disturbance up to 1000 scales down fertility by up to 50%
  const factor = 1000 - Math.floor(disturbance / 2);
  return Math.max(0, Math.floor((base * factor) / 1000));
}

/** Returns true if cell soil is compacted (disturbance >= 500). */
export function isCompacted(map: MapState, cell: number): boolean {
  return (map.soilDisturbance[cell] as number) >= ECOLOGY_RULES.compactionThreshold;
}

export type DefoliationStage = 'PRISTINE' | 'HARVESTED' | 'DEPLETED' | 'BARREN';

/** Section 4.6: Classifies wild vegetation defoliation based on biomass relative to capacity. */
export function defoliationStageFor(biomass: number, capacity: number): DefoliationStage {
  if (capacity <= 0 || biomass >= Math.floor((capacity * 800) / 1000)) return 'PRISTINE';
  if (biomass >= Math.floor((capacity * 400) / 1000)) return 'HARVESTED';
  if (biomass >= Math.floor((capacity * 150) / 1000)) return 'DEPLETED';
  return 'BARREN';
}

/** Section 16.4: Applies passage or strike soil disturbance, checking for road breakdown. */
export function applyColossalTrampling(state: CampaignState, god: GodState, cell: number, amount: number): void {
  const prevDist = state.map.soilDisturbance[cell] as number;
  const nextDist = Math.min(1000, prevDist + amount);
  state.map.soilDisturbance[cell] = nextDist;

  // Section 16.4: Road damage and breakdown under massive trampling
  if (
    state.map.roads
    && state.map.roads[cell] === 1
    && nextDist >= ECOLOGY_RULES.roadDestructionDisturbance
    && sizeRules(god).mass >= ECOLOGY_RULES.roadDestructionMass
  ) {
    state.map.roads[cell] = 0;
    state.history.push({
      eventId: state.history.length + 1,
      turn: state.turn,
      impulse: 0,
      type: 'ROUTE_CHANGED',
      actorIds: [god.id],
      locationIds: [cell],
      causeIds: [],
      observerCivIds: [god.ownerId],
      payload: {
        godId: god.id,
        cell,
        reason: 'ROAD_CRUSHED_BY_GOD',
        disturbance: nextDist,
      },
      schemaVersion: 1,
    });
  }
}

/** Section 4.6: Recovers soil disturbance on land cells not actively occupied by living Gods. */
export function recoverSoil(state: CampaignState): number {
  const { map } = state;
  const underBodies = new Set(
    state.gods
      .filter((g) => g.lifecycle === 'ALIVE')
      .flatMap((g) => occupiedCells(map, g.maskName, g) ?? []),
  );

  // Identify settlements with stewardship or advanced ecology tech
  const stewardshipSettlements: number[] = [];
  const techBonusCivs = new Set<number>();

  for (const civ of state.civs) {
    if (civ.policies && civ.policies.RESOURCE_ETHICS === 'P-STEWARDSHIP') {
      const owned = state.settlements.filter((s) => s.ownerId === civ.id).map((s) => s.cell);
      stewardshipSettlements.push(...owned);
    }
    if (civ.completedTechs && (civ.completedTechs.includes('T-ECO-2') || civ.completedTechs.includes('T-ECO-3'))) {
      techBonusCivs.add(civ.id);
    }
  }

  let recoveredCount = 0;

  for (let cell = 0; cell < map.soilDisturbance.length; cell += 1) {
    const disturbance = map.soilDisturbance[cell] as number;
    if (disturbance <= 0 || underBodies.has(cell)) continue;

    let recoveryRate = ECOLOGY_RULES.baseSoilRecoveryRate;

    // Check stewardship proximity (within 2 hexes of a stewardship settlement)
    const isStewarded = stewardshipSettlements.some((core) => distance(map, core, cell) <= 2);
    if (isStewarded) {
      recoveryRate += ECOLOGY_RULES.stewardshipRecoveryBonus;
    }

    // Check if within territory of a civ with ecology tech
    const nearestCiv = state.settlements
      .filter((s) => distance(map, s.cell, cell) <= 2)
      .map((s) => s.ownerId)[0];
    if (nearestCiv !== undefined && techBonusCivs.has(nearestCiv)) {
      recoveryRate += ECOLOGY_RULES.techEcologyRecoveryBonus;
    }

    map.soilDisturbance[cell] = Math.max(0, disturbance - recoveryRate);
    recoveredCount += 1;
  }

  return recoveredCount;
}

/**
 * Step 3: Ecological replenishment & soil recovery (master Sections 3.2, 4.6).
 * Vegetation regrows up to capacity, halved when soil is compacted (disturbance >= 500).
 * Undisturbed soil naturally recovers toward 0 disturbance.
 */
export function regenerateEcologyWithSoil(state: CampaignState): void {
  const { map } = state;

  // 1. Vegetation regrowth with compaction penalties
  for (let cell = 0; cell < map.biomass.length; cell += 1) {
    const capacity = map.biomassCapacity[cell] as number;
    const current = map.biomass[cell] as number;
    if (current >= capacity) continue;

    const baseRate = BIOME_RULES[BIOMES[map.biome[cell] as number] as Biome].regenRate;
    if (baseRate === 0) continue;

    // Section 4.6: Compaction impairs vegetation regrowth
    const rate = isCompacted(map, cell)
      ? Math.floor((baseRate * (100 - ECOLOGY_RULES.compactionRegenPenaltyPercent)) / 100)
      : baseRate;

    if (rate <= 0) continue;

    map.biomass[cell] = Math.min(
      capacity,
      current + Math.max(1, Math.floor(((capacity - current) * rate) / 1000)),
    );
  }

  // 2. Multi-turn natural soil healing
  recoverSoil(state);
}
