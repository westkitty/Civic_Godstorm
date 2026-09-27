// God mortality transition, finite remains, and corpse geography (master Section 10.1, 10.2, 10.3, 16.5).
// At death, creates tissue reserve (100 * sizeMass), mineral reserve (60 * sizeMass),
// contamination potential (40 * sizeMass) across persistent occupied cells.
// Four decay stages: RECENT (0-3 turns), DECAY (4-23 turns), OSSUARY (24-79 turns), FOSSIL (80+ turns).

import type { CampaignState } from '../core/state.ts';
import { units, type Quantity } from '../core/quantity.ts';
import { distance } from '../world/hex.ts';
import { occupiedCells } from './body.ts';
import { sizeRules, type GodState } from './god.ts';

export type CorpseStage = 'RECENT' | 'DECAY' | 'OSSUARY' | 'FOSSIL';

export interface CorpseState {
  readonly godId: number;
  readonly ownerId: number;
  readonly family: string;
  readonly size: 1 | 2 | 3;
  readonly deathTurn: number;
  readonly anchor: number;
  readonly cells: readonly number[];
  stage: CorpseStage;
  ageTurns: number;
  tissueReserve: Quantity; // whole units * 100
  mineralReserve: Quantity; // whole units * 100
  contamination: number; // 0..1000
  preserved: boolean;
}

export const CORPSE_STAGE_THRESHOLDS = {
  RECENT_MAX: 3,
  DECAY_MAX: 23,
  OSSUARY_MAX: 79,
} as const;

export function corpseStageForAge(ageTurns: number): CorpseStage {
  if (ageTurns <= CORPSE_STAGE_THRESHOLDS.RECENT_MAX) return 'RECENT';
  if (ageTurns <= CORPSE_STAGE_THRESHOLDS.DECAY_MAX) return 'DECAY';
  if (ageTurns <= CORPSE_STAGE_THRESHOLDS.OSSUARY_MAX) return 'OSSUARY';
  return 'FOSSIL';
}

/**
 * Creates physical persistent corpse state upon God death (Section 10.2).
 */
export function createCorpseFromGod(state: CampaignState, god: GodState): CorpseState {
  const size = sizeRules(god);
  const cells = occupiedCells(state.map, god.maskName, god) ?? [god.anchor];
  return {
    godId: god.id,
    ownerId: god.ownerId,
    family: god.genome.family,
    size: god.genome.size,
    deathTurn: state.turn,
    anchor: god.anchor,
    cells: [...cells].sort((a, b) => a - b),
    stage: 'RECENT',
    ageTurns: 0,
    tissueReserve: units(100 * size.mass),
    mineralReserve: units(60 * size.mass),
    contamination: 40 * size.mass * 10,
    preserved: false,
  };
}

/**
 * Section 10.3: Applies one-time historical death shock to owner civilization settlements.
 */
export function applyGodDeathShock(state: CampaignState, god: GodState): void {
  for (const s of state.settlements) {
    if (s.ownerId === god.ownerId) {
      s.legitimacy = Math.max(0, s.legitimacy - 150);
      s.welfare = Math.max(0, s.welfare - 50);
    }
  }
}

/**
 * Section 10.2: Advances corpse lifecycle decay and resolves active site preservation.
 */
export function resolveCorpses(state: CampaignState): void {
  for (const corpse of state.corpses) {
    // Section 10.2: Preserving a site consumes 2 MEDICINE and 2 COIN per turn and halves decay advance
    let isPreserved = false;
    if (corpse.preserved) {
      const civ = state.civs.find((c) => c.id === corpse.ownerId);
      const civSettlement = state.settlements.find((s) => s.ownerId === corpse.ownerId && s.storage.MEDICINE >= 200);
      if (civ && civ.coin >= 2 && civSettlement) {
        civ.coin -= 2;
        civSettlement.storage.MEDICINE -= 200;
        isPreserved = true;
      } else {
        corpse.preserved = false;
      }
    }

    const decayAdvance = isPreserved ? 1 : 2; // tracked in half-turns (integer arithmetic)
    corpse.ageTurns += decayAdvance / 2;

    const oldStage = corpse.stage;
    corpse.stage = corpseStageForAge(Math.floor(corpse.ageTurns));

    if (corpse.stage !== oldStage) {
      state.history.push({
        eventId: state.history.length + 1,
        turn: state.turn,
        impulse: 0,
        type: 'CORPSE_STAGE_CHANGED',
        actorIds: [corpse.godId],
        locationIds: [corpse.anchor],
        causeIds: [],
        observerCivIds: [corpse.ownerId],
        payload: {
          godId: corpse.godId,
          stage: corpse.stage,
          ageTurns: Math.floor(corpse.ageTurns),
        },
        schemaVersion: 1,
      });
    }

    // Contamination hazard on soil during active flesh decomposition
    if (corpse.stage === 'RECENT' || corpse.stage === 'DECAY') {
      for (const cell of corpse.cells) {
        state.map.soilDisturbance[cell] = Math.min(1000, (state.map.soilDisturbance[cell] as number) + 15);
      }
    }
  }
}

export interface HarvestResult {
  ok: boolean;
  harvested: number;
  reason?: string;
}

/**
 * Section 10.2 & 10.3: Harvests finite bio-tissue or mineral remnants from God remains.
 * Extraction advances effective decay by one additional turn per five BIO taken.
 */
export function harvestCorpse(
  state: CampaignState,
  settlementId: number,
  godId: number,
  resource: 'BIO' | 'ORE' | 'STONE',
  wantedUnits: number,
): HarvestResult {
  const settlement = state.settlements.find((s) => s.id === settlementId);
  if (!settlement) return { ok: false, harvested: 0, reason: 'settlement not found' };

  const corpse = state.corpses.find((c) => c.godId === godId);
  if (!corpse) return { ok: false, harvested: 0, reason: 'corpse not found' };

  // Settlement proximity check (core must be within 3 hexes of any corpse cell)
  const reachable = corpse.cells.some((c) => distance(state.map, settlement.cell, c) <= 3);
  if (!reachable) return { ok: false, harvested: 0, reason: 'corpse is beyond reach of settlement' };

  if (resource === 'BIO') {
    if (corpse.stage !== 'RECENT' && corpse.stage !== 'DECAY') {
      return { ok: false, harvested: 0, reason: 'tissue is exhausted in ossuary/fossil stage' };
    }
    const available = Math.floor(corpse.tissueReserve / 100);
    const take = Math.min(wantedUnits, available);
    if (take <= 0) return { ok: false, harvested: 0, reason: 'no tissue reserve remaining' };

    corpse.tissueReserve -= units(take);
    settlement.storage.BIO = (settlement.storage.BIO ?? 0) + units(take);
    // Section 10.2: Extraction advances effective decay by one additional turn per 5 BIO taken
    corpse.ageTurns += Math.ceil(take / 5);
    corpse.stage = corpseStageForAge(Math.floor(corpse.ageTurns));

    state.history.push({
      eventId: state.history.length + 1,
      turn: state.turn,
      impulse: 0,
      type: 'CORPSE_HARVESTED',
      actorIds: [settlement.ownerId, corpse.godId],
      locationIds: [corpse.anchor],
      causeIds: [],
      observerCivIds: [settlement.ownerId],
      payload: {
        settlementId,
        godId,
        resource: 'BIO',
        units: take,
        remainingTissue: Math.floor(corpse.tissueReserve / 100),
      },
      schemaVersion: 1,
    });
    return { ok: true, harvested: take };
  }

  // ORE or STONE from structural bone / mineral framework
  const available = Math.floor(corpse.mineralReserve / 100);
  const take = Math.min(wantedUnits, available);
  if (take <= 0) return { ok: false, harvested: 0, reason: 'no mineral reserve remaining' };

  corpse.mineralReserve -= units(take);
  settlement.storage[resource] = (settlement.storage[resource] ?? 0) + units(take);

  state.history.push({
    eventId: state.history.length + 1,
    turn: state.turn,
    impulse: 0,
    type: 'CORPSE_HARVESTED',
    actorIds: [settlement.ownerId, corpse.godId],
    locationIds: [corpse.anchor],
    causeIds: [],
    observerCivIds: [settlement.ownerId],
    payload: {
      settlementId,
      godId,
      resource,
      units: take,
      remainingMineral: Math.floor(corpse.mineralReserve / 100),
    },
    schemaVersion: 1,
  });
  return { ok: true, harvested: take };
}
