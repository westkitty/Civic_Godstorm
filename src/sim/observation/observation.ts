// Observation layer (master Sections 4.4, 9, 11). Each civilization keeps remembered map knowledge;
// planners and previews receive an ObservationView built from that knowledge plus the civ's own
// records, never a reference to true world state. M02 subset: sight radius only (hill bonus and
// line-of-sight blocking arrive with later exploration work).

import type { CampaignState, ObservationState, SettlementState } from '../core/state.ts';
import { occupiedCells, type CellKnowledge, type Knowledge } from '../gods/body.ts';
import type { GodState } from '../gods/god.ts';
import { SENSOR_SIGHT } from '../gods/grammar.ts';
import { cellsWithin, distance, type MapDimensions } from '../world/hex.ts';

export const SETTLEMENT_SIGHT = 2;

export function emptyObservation(civId: number, cellCount: number): ObservationState {
  const fill = (value: number): number[] => new Array<number>(cellCount).fill(value);
  return {
    civId,
    visibility: fill(0),
    knownBiome: fill(-1),
    knownElevation: fill(-1),
    knownSettlement: fill(-1),
    knownFarm: fill(-1),
    knownGod: fill(-1),
    lastSeenTurn: fill(-1),
  };
}

function godCells(state: CampaignState, god: GodState): number[] {
  return occupiedCells(state.map, god.maskName, god) ?? [];
}

/** Cells currently observed by a civilization. */
export function visibleCells(state: CampaignState, civId: number): Set<number> {
  const visible = new Set<number>();
  for (const settlement of state.settlements) {
    if (settlement.ownerId !== civId) continue;
    for (const cell of cellsWithin(state.map, settlement.cell, SETTLEMENT_SIGHT)) visible.add(cell);
  }
  for (const god of state.gods) {
    if (god.ownerId !== civId || god.lifecycle !== 'ALIVE') continue;
    const radius = SENSOR_SIGHT[god.genome.sensor];
    for (const cell of godCells(state, god)) for (const seen of cellsWithin(state.map, cell, radius)) visible.add(seen);
  }
  return visible;
}

/** Refreshes one civilization's knowledge from true state for the cells it can currently see. */
export function updateObservation(state: CampaignState, civId: number): void {
  const observation = state.observations.find((o) => o.civId === civId);
  if (!observation) throw new Error(`no observation record for civ ${civId}`);
  const visible = visibleCells(state, civId);
  const settlementAt = new Map(state.settlements.map((s) => [s.cell, s.ownerId]));
  const farmAt = new Map(state.settlements.flatMap((s) => s.farmSites.map((f) => [f.cell, s.ownerId] as const)));
  const godAt = new Map(state.gods.filter((g) => g.lifecycle === 'ALIVE').flatMap((g) => godCells(state, g).map((cell) => [cell, g.id] as const)));
  for (let cell = 0; cell < observation.visibility.length; cell += 1) {
    if (!visible.has(cell)) {
      if (observation.visibility[cell] === 2) observation.visibility[cell] = 1;
      // Bodies move: a remembered position is not a current obstacle.
      observation.knownGod[cell] = -1;
      continue;
    }
    observation.visibility[cell] = 2;
    observation.knownBiome[cell] = state.map.biome[cell] as number;
    observation.knownElevation[cell] = state.map.elevation[cell] as number;
    observation.knownSettlement[cell] = settlementAt.get(cell) ?? -1;
    observation.knownFarm[cell] = farmAt.get(cell) ?? -1;
    observation.knownGod[cell] = godAt.get(cell) ?? -1;
    observation.lastSeenTurn[cell] = state.turn;
  }
}

export function updateAllObservations(state: CampaignState): void {
  for (const civ of state.civs) updateObservation(state, civ.id);
}

function claimOwnersAround(dims: MapDimensions, cores: ReadonlyMap<number, number>, cell: number): number[] {
  const owners: number[] = [];
  for (const [core, owner] of cores) if (distance(dims, core, cell) <= 1 && !owners.includes(owner)) owners.push(owner);
  return owners.sort((a, b) => a - b);
}

/** Complete true-state knowledge, used only by the resolver to enforce physics. */
export function truthKnowledge(state: CampaignState, movingGodId: number): Knowledge {
  const settlementAt = new Map(state.settlements.map((s) => [s.cell, s.ownerId]));
  const farmAt = new Map(state.settlements.flatMap((s) => s.farmSites.map((f) => [f.cell, s.ownerId] as const)));
  const otherGods = new Set(state.gods.filter((g) => g.id !== movingGodId && g.lifecycle === 'ALIVE').flatMap((g) => godCells(state, g)));
  return {
    dims: state.map,
    cell: (index: number): CellKnowledge => ({
      known: true,
      biome: state.map.biome[index] as number,
      elevation: state.map.elevation[index] as number,
      settlementOwner: settlementAt.get(index) ?? null,
      farmOwner: farmAt.get(index) ?? null,
      otherGod: otherGods.has(index),
      claimOwners: claimOwnersAround(state.map, settlementAt, index),
    }),
  };
}

/** Everything a civilization may use to plan: its knowledge and its own records only. */
export interface ObservationView {
  readonly civId: number;
  readonly turn: number;
  readonly dims: MapDimensions;
  readonly observation: Readonly<ObservationState>;
  readonly ownGods: readonly GodState[];
  readonly ownSettlements: readonly SettlementState[];
}

export function buildObservationView(state: CampaignState, civId: number): ObservationView {
  const observation = state.observations.find((o) => o.civId === civId);
  if (!observation) throw new Error(`no observation record for civ ${civId}`);
  return structuredClone({
    civId,
    turn: state.turn,
    dims: { width: state.map.width, height: state.map.height },
    observation,
    ownGods: state.gods.filter((g) => g.ownerId === civId),
    ownSettlements: state.settlements.filter((s) => s.ownerId === civId),
  });
}

/** Planning knowledge from an observation view; unknown cells are optimistic estimates, flagged. */
export function observedKnowledge(view: ObservationView, movingGodId: number): Knowledge {
  const o = view.observation;
  const cores = new Map<number, number>();
  for (let cell = 0; cell < o.knownSettlement.length; cell += 1) {
    const owner = o.knownSettlement[cell] as number;
    if (owner >= 0) cores.set(cell, owner);
  }
  return {
    dims: view.dims,
    cell: (index: number): CellKnowledge => {
      const known = (o.visibility[index] as number) > 0;
      const godId = o.knownGod[index] as number;
      const farm = o.knownFarm[index] as number;
      const core = o.knownSettlement[index] as number;
      return {
        known,
        biome: known ? (o.knownBiome[index] as number) : -1,
        elevation: known ? (o.knownElevation[index] as number) : -1,
        settlementOwner: core >= 0 ? core : null,
        farmOwner: farm >= 0 ? farm : null,
        otherGod: godId >= 0 && godId !== movingGodId && o.visibility[index] === 2,
        claimOwners: claimOwnersAround(view.dims, cores, index),
      };
    },
  };
}
