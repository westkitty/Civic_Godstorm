// Authoritative campaign state (master Sections 13.2, 16.1). Plain integer data only, so it is
// canonically hashable, cloneable and serialisable. Presentation state never lives here.

import type { BuildKind, Job, PhysicalResource } from '../data/rules.ts';
import type { RngStreams } from './rng.ts';
import type { Quantity } from './quantity.ts';
import type { MapSizeName } from '../world/hex.ts';
import type { GodState } from '../gods/god.ts';

export interface MapState {
  readonly size: MapSizeName;
  readonly width: number;
  readonly height: number;
  /** Per-cell fields, index = row * width + column. */
  elevation: number[];
  biome: number[];
  temperature: number[];
  moisture: number[];
  fertility: number[];
  biomass: number[];
  biomassCapacity: number[];
  /** Quarryable stone, whole units. */
  stoneReserve: number[];
  /** Section 3.2 soil disturbance 0..1000. */
  soilDisturbance: number[];
}

/** Per-civilization map knowledge (master Sections 9, 11). Never a pointer into true state. */
export interface ObservationState {
  readonly civId: number;
  /** 0 unknown, 1 remembered, 2 currently observed. */
  visibility: number[];
  /** Last observed biome index, -1 unknown. */
  knownBiome: number[];
  knownElevation: number[];
  /** Owner civ ID of an observed settlement core, -1 none. */
  knownSettlement: number[];
  /** Owner civ ID of an observed farm parcel, -1 none. */
  knownFarm: number[];
  /** God ID observed occupying the cell when last seen, -1 none. Valid only while visible. */
  knownGod: number[];
  lastSeenTurn: number[];
}

export interface CivState {
  readonly id: number;
  readonly name: string;
  readonly emblem: number;
  readonly controller: 'HUMAN' | 'AI';
  coin: Quantity;
  knowledge: Quantity;
  readonly capitalSettlementId: number;
}

export interface FarmSite {
  readonly cell: number;
}

export interface ConstructionItem {
  readonly id: number;
  readonly kind: BuildKind;
  /** Target cell for infrastructure; the settlement cell for district buildings. */
  readonly cell: number;
  /** Materials are debited when the item is queued (a reservation keyed by the command). */
  readonly reservedBy: string;
  readonly workRequired: Quantity;
  workDone: Quantity;
}

export type JobAllocation = Record<Job, number>;

export interface SettlementState {
  readonly id: number;
  readonly ownerId: number;
  readonly cell: number;
  readonly name: string;
  readonly originalCapitalOf: number | null;
  populationMilli: number;
  dwellings: number;
  hallIntegrity: number;
  farmSites: FarmSite[];
  /** Assigned milli-workers per job. */
  jobs: JobAllocation;
  storage: Record<PhysicalResource, Quantity>;
  /** Exact per-ledger remainders (numerators) carried between turns. */
  carry: Record<string, number>;
  queue: ConstructionItem[];
  welfare: number;
  foodCoverage: number;
  shortageTurns: number;
  legitimacy: number;
}

export type HistoryEventType = 'CITY_FOUNDED';

export interface HistoryEvent {
  readonly eventId: number;
  readonly turn: number;
  readonly impulse: number;
  readonly type: HistoryEventType;
  readonly actorIds: number[];
  readonly locationIds: number[];
  readonly causeIds: number[];
  readonly observerCivIds: number[];
  readonly payload: Record<string, string | number>;
  readonly schemaVersion: 1;
}

export interface SettlementTurnSummary {
  readonly settlementId: number;
  readonly produced: Record<PhysicalResource, Quantity>;
  readonly consumedFood: Quantity;
  readonly requiredFood: Quantity;
  readonly spoiled: Record<PhysicalResource, Quantity>;
  readonly births: number;
  readonly deaths: number;
  readonly workApplied: Quantity;
  readonly completed: BuildKind[];
  readonly warnings: string[];
}

export interface GodTurnSummary {
  readonly godId: number;
  readonly apSpent: number;
  readonly movementAp: number;
  readonly steps: number;
  readonly nutritionGained: number;
  readonly nutritionConsumed: number;
  readonly shortfall: number;
  readonly fed: boolean;
  readonly rested: boolean;
  readonly disturbedCells: number[];
  readonly halted: string | null;
}

export interface TurnSummary {
  readonly turn: number;
  readonly settlements: SettlementTurnSummary[];
  readonly gods: GodTurnSummary[];
}

export interface GenerationRecord {
  readonly candidateIndex: number;
  readonly candidateSeed: string;
  readonly startAttempts: number;
  readonly rejections: Record<string, number>;
}

export interface CampaignState {
  readonly schemaVersion: 1;
  readonly simulationVersion: string;
  readonly rulesHash: string;
  readonly campaignId: string;
  readonly worldSeed: string;
  /** Committed turns so far; also the state version commands must name. */
  turn: number;
  nextEntityId: number;
  nextEventId: number;
  rng: RngStreams;
  map: MapState;
  civs: CivState[];
  settlements: SettlementState[];
  gods: GodState[];
  observations: ObservationState[];
  history: HistoryEvent[];
  lastTurn: TurnSummary | null;
  readonly generation: GenerationRecord;
}
