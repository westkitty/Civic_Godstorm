// Mechanics data for the M01 kernel. Values cite the master section that fixes them. Entries marked
// "M01 default" fill a coefficient the master leaves open; they are tuning data, changed only by a
// reviewed data revision (master Section 16), and are listed in docs/evidence/M01.md.

import { canonicalHash } from '../core/canonical.ts';

export const SIMULATION_VERSION = 'cg-sim-m02.1';

export const PHYSICAL_RESOURCES = ['FOOD', 'TIMBER', 'STONE', 'ORE', 'TOOLS', 'MEDICINE', 'BIO'] as const;
export type PhysicalResource = (typeof PHYSICAL_RESOURCES)[number];

/** Section 3.3: nine V1 biomes. Indices are stored in map arrays. */
export const BIOMES = [
  'DEEP_SEA',
  'COAST_SHALLOW',
  'GRASSLAND',
  'WOODLAND',
  'BOREAL',
  'WETLAND',
  'DESERT',
  'TUNDRA',
  'VOLCANIC_UPLAND',
] as const;
export type Biome = (typeof BIOMES)[number];
export const BIOME_INDEX = Object.fromEntries(BIOMES.map((name, index) => [name, index])) as Record<Biome, number>;

export const TEMPERATURE_BANDS = ['COLD', 'TEMPERATE', 'HOT'] as const;

export interface BiomeRule {
  readonly water: boolean;
  /** Section 4.6 regeneration rate (per mille of missing capacity). */
  readonly regenRate: number;
  /** M01 default: ecological carrying capacity 0..1000. */
  readonly biomassCapacity: number;
  /** M01 default: base fertility before moisture/coast adjustment. */
  readonly fertilityBase: number;
  readonly woodland: boolean;
}

export const BIOME_RULES: Readonly<Record<Biome, BiomeRule>> = {
  DEEP_SEA: { water: true, regenRate: 15, biomassCapacity: 400, fertilityBase: 0, woodland: false },
  COAST_SHALLOW: { water: true, regenRate: 80, biomassCapacity: 700, fertilityBase: 0, woodland: false },
  GRASSLAND: { water: false, regenRate: 60, biomassCapacity: 800, fertilityBase: 800, woodland: false },
  WOODLAND: { water: false, regenRate: 30, biomassCapacity: 1000, fertilityBase: 600, woodland: true },
  BOREAL: { water: false, regenRate: 30, biomassCapacity: 900, fertilityBase: 350, woodland: true },
  WETLAND: { water: false, regenRate: 80, biomassCapacity: 900, fertilityBase: 850, woodland: false },
  DESERT: { water: false, regenRate: 15, biomassCapacity: 150, fertilityBase: 100, woodland: false },
  TUNDRA: { water: false, regenRate: 15, biomassCapacity: 250, fertilityBase: 150, woodland: false },
  VOLCANIC_UPLAND: { water: false, regenRate: 15, biomassCapacity: 300, fertilityBase: 450, woodland: false },
};

export const WORLD_RULES = {
  /** Section 3.2: elevation 0..255. M01 defaults for water thresholds. */
  deepSeaBelow: 64,
  seaLevel: 90,
  uplandAbove: 215,
  /** M01 default: land at or above this elevation carries quarryable stone. */
  stoneElevation: 140,
  /** M01 default: quarryable stone reserve per stone cell, in whole units. */
  stoneReservePerCell: 400,
  /** M01 default fertility bonus for land adjacent to shallow water. */
  coastalFertilityBonus: 200,
  /** Section 3.3: at most 64 start attempts per world candidate, 32 world candidates. */
  maxStartAttempts: 64,
  maxWorldCandidates: 32,
  /** M01 default: minimum wrapped distance between starting settlements (>= Section 16.7's 3). */
  minStartSpacing: 8,
  /** Section 16.7: settlement cores at least three wrapped steps apart. */
  minSettlementSpacing: 3,
  /** Section 6.2: minimum workable farm fertility. */
  minFarmFertility: 250,
} as const;

export const ECONOMY_RULES = {
  /** Section 6.2 starting inventory, whole units. */
  startingStock: { FOOD: 60, TIMBER: 40, STONE: 30, ORE: 10, TOOLS: 10, MEDICINE: 4, BIO: 0 } satisfies Record<PhysicalResource, number>,
  startingCoin: 40,
  startingPopulationUnits: 5,
  /** Section 6.2: base storage per physical resource; overflow spoils 10%/turn. */
  baseStorage: 40,
  spoilagePercent: 10,
  /** Section 6.2 base settlement yield. */
  baseFoodYield: 2,
  baseKnowledgeYield: 1,
  /** Section 6.1: household consumption per full population unit. */
  householdFoodPerPop: 2,
  /** Section 16.5: 750 of every 1000 milli-population can work. */
  laborPerMille: 750,
  /** Section 6.2 workplace outputs per full worker. */
  farmFoodPerWorker: 4,
  forestryTimberPerWorker: 3,
  quarryStonePerWorker: 3,
  /** Section 6.2/16.5 construction work per builder. */
  workPerBuilder: 4,
  /** Section 6.2: at most four staffed jobs per site. */
  maxWorkersPerSite: 4,
  /** M01 default: woodland biomass pool units consumed per TIMBER (mirrors 10 pool = 1 nutrition). */
  biomassPerTimber: 10,
  /** Section 6.2: 1 COIN per full population when household food coverage >= 500. */
  duesPerPop: 1,
  duesFoodCoverageFloor: 500,
  /** Section 6.3: HALL upkeep 2 COIN; unpaid maintenance degrades integrity 5/turn. */
  hallUpkeep: 2,
  unpaidIntegrityLoss: 5,
  /** Section 16.5 housing: 6 in the core, +6 per DWELLING parcel, cap 32. */
  coreHousing: 6,
  dwellingHousing: 6,
  maxHousing: 32,
  maxDistrictParcels: 6,
  /** Section 6.1: settlement population cap. */
  maxSettlementPopulation: 32,
  /** Section 16.5 welfare weights (per mille). */
  welfareWeights: { food: 450, housing: 200, health: 150, safety: 100, participation: 100 },
  /** Section 16.5: health 500 without infirmary; safety 1000 absent hazards. */
  baseHealth: 500,
  baseSafety: 1000,
  /** M01 default: participation follows legitimacy, which starts neutral. */
  startingLegitimacy: 500,
  /** Section 6.1 growth. */
  growthWelfareFloor: 700,
  growthCapMilli: 100,
  growthPercent: 1,
  growthReserveTurns: 2,
  /** Section 6.1: famine deaths begin only after two shortage turns. */
  famineGraceTurns: 2,
  /** M01 default: famine deaths per turn = ceil(unfed milli-population * 10%). */
  famineDeathPercent: 10,
  /** M01 default: bounded build queue length per settlement. */
  maxQueueLength: 8,
} as const;

export type BuildKind = 'DWELLING' | 'FARM';

/** Section 6.3 costs in whole units; work in whole work units. */
export const BUILD_RULES: Readonly<Record<BuildKind, { readonly materials: Partial<Record<PhysicalResource, number>>; readonly work: number }>> = {
  DWELLING: { materials: { TIMBER: 12, STONE: 8 }, work: 10 },
  FARM: { materials: { TIMBER: 4 }, work: 4 },
};

/** God rules (master Sections 2.3, 4.5, 4.6, 16.1, 16.3, 16.4). */
export const GOD_RULES = {
  apPerTurn: 4,
  maxApPerImpulse: 2,
  maxCrossingsPerImpulse: 2,
  impulses: 4,
  maxWaypoints: 12,
  /** Section 4.6 fatigue thresholds: 60+ -> 3 AP, 85+ -> 2 AP, 100 -> REST/FEED/HOLD only. */
  fatigueAp: [{ atLeast: 100, ap: 0 }, { atLeast: 85, ap: 2 }, { atLeast: 60, ap: 3 }],
  feedAp: 2,
  /** FEED takes up to two turns of base upkeep. */
  feedTurnsOfUpkeep: 2,
  /** Ten biomass pool units equal one nutrition. */
  biomassPerNutrition: 10,
  restFatigueRecovery: 30,
  restVitalHeal: 10,
  restRegionHeal: 20,
  shortageFatigue: 15,
  shortageVitalDamagePerMass: 20,
  forcefulFatigue: 15,
  /** Heavy passage disturbance 10 x mass; careful x1/2, forceful x3/2 (Section 16.4). */
  passageDisturbancePerMass: 10,
  /** Section 2.1: the God starts with three base-upkeep turns of reserves. */
  startingReserveTurns: 3,
  regionHealth: 400,
  /** M02 default: ecological support check for the start (Section 3.3's twenty turns, no regrowth credit). */
  startSupportTurns: 20,
  /** M02 defaults: hills (elevation >= 160) and forest cost 2; shallow fords cost 2; deep water is illegal for PILLAR. */
  hillElevation: 160,
  /** Planner cost units: AP x 16 plus 1 per turn step, so turning never beats moving. */
  plannerApWeight: 16,
  plannerMaxExpansions: 20000,
  startingTrust: 500,
} as const;

export const JOBS = ['farm', 'forestry', 'quarry', 'builder'] as const;
export type Job = (typeof JOBS)[number];

export const RULES = {
  simulationVersion: SIMULATION_VERSION,
  biomes: BIOMES,
  biomeRules: BIOME_RULES,
  world: WORLD_RULES,
  economy: ECONOMY_RULES,
  build: BUILD_RULES,
  jobs: JOBS,
  god: GOD_RULES,
};

/** Hash of the active rules data; saves and replays record it (Section 13.2 rulesHash). */
export const RULES_HASH = canonicalHash(RULES);
