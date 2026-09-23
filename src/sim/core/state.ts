// Authoritative campaign state (master Sections 13.2, 16.1). Plain integer data only, so it is
// canonically hashable, cloneable and serialisable. Presentation state never lives here.

import type { BuildKind, Job, PhysicalResource } from '../data/rules.ts';
import type { RngStreams } from './rng.ts';
import type { Quantity } from './quantity.ts';
import type { MapSizeName } from '../world/hex.ts';

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

export interface TurnSummary {
  readonly turn: number;
  readonly settlements: SettlementTurnSummary[];
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
  history: HistoryEvent[];
  lastTurn: TurnSummary | null;
  readonly generation: GenerationRecord;
}
