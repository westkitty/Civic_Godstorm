// New-campaign construction (master Sections 2.1, 3.3, 6.2). Bounded, diagnosed world search:
// at most 32 world candidates, each with at most 64 start attempts per civilization.

import { initStreams, assertSeed } from './core/rng.ts';
import { units } from './core/quantity.ts';
import type { CampaignState, CivState, HistoryEvent, SettlementState } from './core/state.ts';
import { ECONOMY_RULES, PHYSICAL_RESOURCES, RULES_HASH, SIMULATION_VERSION, WORLD_RULES } from './data/rules.ts';
import { generateMap, placeStarts, startFarmCells } from './world/generate.ts';
import type { MapSizeName } from './world/hex.ts';

export interface NewCampaignOptions {
  readonly seed: string;
  readonly size: MapSizeName;
  /** Total civilizations including the human (Section 1.1: 2-6). */
  readonly civCount: number;
}

export class WorldGenerationError extends Error {
  override readonly name = 'WorldGenerationError';
  readonly seed: string;
  readonly rejections: Record<string, number>;

  constructor(seed: string, rejections: Record<string, number>) {
    super(`No valid world for seed "${seed}" after ${WORLD_RULES.maxWorldCandidates} candidates: ${JSON.stringify(rejections)}`);
    this.seed = seed;
    this.rejections = rejections;
  }
}

export function candidateSeed(seed: string, index: number): string {
  return index === 0 ? seed : `${seed}~${index}`;
}

export function createCampaign(options: NewCampaignOptions): CampaignState {
  assertSeed(options.seed);
  if (!Number.isInteger(options.civCount) || options.civCount < 1 || options.civCount > 6) {
    throw new RangeError(`civCount must be 1-6, got ${options.civCount}`);
  }
  const rng = initStreams(options.seed);
  const rejections: Record<string, number> = {};
  for (let index = 0; index < WORLD_RULES.maxWorldCandidates; index += 1) {
    const worldSeed = candidateSeed(options.seed, index);
    const map = generateMap(options.size, worldSeed);
    const placement = placeStarts(map, options.civCount, rng);
    for (const [reason, count] of Object.entries(placement.rejections)) rejections[reason] = (rejections[reason] ?? 0) + count;
    if (!placement.ok) {
      rejections.worldCandidateRejected = (rejections.worldCandidateRejected ?? 0) + 1;
      continue;
    }

    let nextEntityId = 1;
    const civs: CivState[] = [];
    const settlements: SettlementState[] = [];
    const history: HistoryEvent[] = [];
    const civIds = placement.cells.map(() => nextEntityId++);
    placement.cells.forEach((cell, civIndex) => {
      const civId = civIds[civIndex] as number;
      const settlementId = nextEntityId++;
      civs.push({
        id: civId,
        name: `Civilization ${civIndex + 1}`,
        emblem: civIndex,
        controller: civIndex === 0 ? 'HUMAN' : 'AI',
        coin: units(ECONOMY_RULES.startingCoin),
        knowledge: 0,
        capitalSettlementId: settlementId,
      });
      settlements.push({
        id: settlementId,
        ownerId: civId,
        cell,
        name: `Settlement ${settlementId}`,
        originalCapitalOf: civId,
        populationMilli: ECONOMY_RULES.startingPopulationUnits * 1000,
        dwellings: 0,
        hallIntegrity: 100,
        farmSites: startFarmCells(map, cell).map((farmCell) => ({ cell: farmCell })),
        // Section 16.5 guaranteed opening: two farmers, one materials worker, 750 milli builders.
        jobs: { farm: 2000, forestry: 1000, quarry: 0, builder: 750 },
        storage: Object.fromEntries(PHYSICAL_RESOURCES.map((r) => [r, units(ECONOMY_RULES.startingStock[r])])) as SettlementState['storage'],
        carry: {},
        queue: [],
        welfare: 0,
        foodCoverage: 1000,
        shortageTurns: 0,
        legitimacy: ECONOMY_RULES.startingLegitimacy,
      });
      history.push({
        eventId: history.length + 1,
        turn: 0,
        impulse: 0,
        type: 'CITY_FOUNDED',
        actorIds: [civId, settlementId],
        locationIds: [cell],
        causeIds: [],
        observerCivIds: [civId],
        payload: { reason: 'campaign start' },
        schemaVersion: 1,
      });
    });

    return {
      schemaVersion: 1,
      simulationVersion: SIMULATION_VERSION,
      rulesHash: RULES_HASH,
      campaignId: `cg:${options.seed}:${options.size}:${options.civCount}`,
      worldSeed: options.seed,
      turn: 0,
      nextEntityId,
      nextEventId: history.length + 1,
      rng,
      map,
      civs,
      settlements,
      history,
      lastTurn: null,
      generation: { candidateIndex: index, candidateSeed: worldSeed, startAttempts: placement.attempts, rejections },
    };
  }
  throw new WorldGenerationError(options.seed, rejections);
}
