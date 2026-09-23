// Deterministic world generation (master Section 3.3), M01 subset: integer value-noise elevation and
// moisture, latitude temperature, biome assignment, fertility, biomass and stone, then bounded start
// placement. Gameplay noise is integer hash-based (Section 16.7), never floating-point.

import { fnv1a32, RngCursor, type RngStreams } from '../core/rng.ts';
import type { MapState } from '../core/state.ts';
import { BIOME_INDEX, BIOME_RULES, BIOMES, WORLD_RULES, type Biome } from '../data/rules.ts';
import { cellsWithin, distance, MAP_SIZES, neighbors, type MapDimensions, type MapSizeName } from './hex.ts';

const CONTRAST = 2;

const OCTAVES = [
  { spacing: 16, weight: 4 },
  { spacing: 8, weight: 2 },
  { spacing: 4, weight: 1 },
] as const;

/** Integer value noise 0..1000 over offset coordinates, wrapping east-west. */
export function valueNoiseField(dims: MapDimensions, seed: string, label: string): number[] {
  const field = new Array<number>(dims.width * dims.height).fill(0);
  let totalWeight = 0;
  for (const { spacing, weight } of OCTAVES) {
    totalWeight += weight;
    const latticeColumns = dims.width / spacing;
    const latticeRows = Math.floor(dims.height / spacing) + 2;
    const lattice: number[] = [];
    for (let ly = 0; ly < latticeRows; ly += 1) {
      for (let lx = 0; lx < latticeColumns; lx += 1) {
        lattice.push(fnv1a32(`${seed}:${label}:${spacing}:${lx}:${ly}`) % 1001);
      }
    }
    const at = (lx: number, ly: number): number => lattice[ly * latticeColumns + (lx % latticeColumns)] as number;
    const area = spacing * spacing;
    for (let r = 0; r < dims.height; r += 1) {
      const ly = Math.floor(r / spacing);
      const fy = r % spacing;
      for (let c = 0; c < dims.width; c += 1) {
        const lx = Math.floor(c / spacing);
        const fx = c % spacing;
        const value = Math.floor(
          (at(lx, ly) * (spacing - fx) * (spacing - fy) +
            at(lx + 1, ly) * fx * (spacing - fy) +
            at(lx, ly + 1) * (spacing - fx) * fy +
            at(lx + 1, ly + 1) * fx * fy) /
            area,
        );
        const index = r * dims.width + c;
        field[index] = (field[index] as number) + value * weight;
      }
    }
  }
  // Averaged octaves cluster near the middle; an integer contrast stretch restores oceans, uplands,
  // wet and dry regions (M01 default factor 2).
  return field.map((sum) => Math.min(1000, Math.max(0, 500 + (Math.floor(sum / totalWeight) - 500) * CONTRAST)));
}

function temperatureBand(dims: MapDimensions, row: number, elevation: number): number {
  const latitude = Math.floor((Math.abs(2 * row - (dims.height - 1)) * 1000) / (dims.height - 1));
  const warmth = 1000 - latitude - Math.max(0, elevation - 150) * 2;
  if (warmth < 300) return 0;
  if (warmth > 750) return 2;
  return 1;
}

function chooseBiome(elevation: number, band: number, moisture: number): Biome {
  if (elevation < WORLD_RULES.deepSeaBelow) return 'DEEP_SEA';
  if (elevation < WORLD_RULES.seaLevel) return 'COAST_SHALLOW';
  if (elevation >= WORLD_RULES.uplandAbove) return 'VOLCANIC_UPLAND';
  if (band === 0) return moisture > 500 ? 'BOREAL' : 'TUNDRA';
  if (band === 2 && moisture < 350) return 'DESERT';
  if (moisture > 700) return 'WETLAND';
  if (moisture > 450) return 'WOODLAND';
  return 'GRASSLAND';
}

export function generateMap(size: MapSizeName, seed: string): MapState {
  const dims = MAP_SIZES[size];
  const cellCount = dims.width * dims.height;
  const elevationNoise = valueNoiseField(dims, seed, 'elevation');
  const moistureNoise = valueNoiseField(dims, seed, 'moisture');
  const elevation = elevationNoise.map((value) => Math.floor((value * 255) / 1000));
  const temperature = elevation.map((value, index) => temperatureBand(dims, Math.floor(index / dims.width), value));
  const biome = elevation.map((value, index) =>
    BIOME_INDEX[chooseBiome(value, temperature[index] as number, moistureNoise[index] as number)]);
  const isShallow = (index: number): boolean => biome[index] === BIOME_INDEX.COAST_SHALLOW;
  const moisture: number[] = [];
  const fertility: number[] = [];
  const biomassCapacity: number[] = [];
  const stoneReserve: number[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    const rule = BIOME_RULES[BIOMES[biome[index] as number] as Biome];
    const coastal = !rule.water && neighbors(dims, index).some((n) => n >= 0 && isShallow(n));
    const wet = Math.min(1000, (moistureNoise[index] as number) + (coastal ? 150 : 0));
    moisture.push(wet);
    fertility.push(rule.water ? 0 : Math.min(1000, rule.fertilityBase + Math.floor((wet * 6) / 10) + (coastal ? WORLD_RULES.coastalFertilityBonus : 0)));
    biomassCapacity.push(rule.biomassCapacity);
    stoneReserve.push(!rule.water && (elevation[index] as number) >= WORLD_RULES.stoneElevation ? WORLD_RULES.stoneReservePerCell : 0);
  }
  return {
    size,
    width: dims.width,
    height: dims.height,
    elevation,
    biome,
    temperature,
    moisture,
    fertility,
    biomass: [...biomassCapacity],
    biomassCapacity,
    stoneReserve,
  };
}

export function isWater(map: MapState, cell: number): boolean {
  return BIOME_RULES[BIOMES[map.biome[cell] as number] as Biome].water;
}

export function isWoodland(map: MapState, cell: number): boolean {
  return BIOME_RULES[BIOMES[map.biome[cell] as number] as Biome].woodland;
}

const SETTLEABLE: ReadonlySet<number> = new Set([BIOME_INDEX.GRASSLAND, BIOME_INDEX.WOODLAND, BIOME_INDEX.WETLAND]);

/** Two farm parcels at full fertility, adjacent to the core (Section 16.5 guaranteed opening). */
export function startFarmCells(map: MapState, cell: number): number[] {
  return neighbors(map, cell)
    .filter((n) => n >= 0 && !isWater(map, n) && map.fertility[n] === 1000)
    .slice(0, 2);
}

export interface StartRequirementResult {
  readonly ok: boolean;
  readonly reason: string;
}

/** Static site requirements (Section 3.3, M01 subset). Spacing is checked separately. */
export function checkStartSite(map: MapState, cell: number): StartRequirementResult {
  if (!SETTLEABLE.has(map.biome[cell] as number)) return { ok: false, reason: 'unsettleableBiome' };
  if (startFarmCells(map, cell).length < 2) return { ok: false, reason: 'noOpeningFarmland' };
  if (!cellsWithin(map, cell, 2).some((n) => n !== cell && isWoodland(map, n))) return { ok: false, reason: 'noTimberAccess' };
  if (!cellsWithin(map, cell, 2).some((n) => (map.stoneReserve[n] as number) > 0)) return { ok: false, reason: 'noStoneAccess' };
  return { ok: true, reason: 'ok' };
}

export interface StartPlacement {
  readonly ok: boolean;
  readonly cells: number[];
  /** Candidate examinations used for this world (at most 64, Section 3.3). */
  readonly attempts: number;
  readonly rejections: Record<string, number>;
}

/**
 * At most 64 deterministic start attempts per world candidate (Section 3.3): candidates are
 * enumerated in stable cell order, shuffled with the STARTS stream, and examined in that order.
 */
export function placeStarts(map: MapState, civCount: number, streams: RngStreams): StartPlacement {
  const rejections: Record<string, number> = {};
  const reject = (reason: string): void => {
    rejections[reason] = (rejections[reason] ?? 0) + 1;
  };
  const candidates: number[] = [];
  for (let cell = 0; cell < map.width * map.height; cell += 1) {
    if (checkStartSite(map, cell).ok) candidates.push(cell);
  }
  if (candidates.length < civCount) {
    reject('tooFewCandidateSites');
    return { ok: false, cells: [], attempts: 0, rejections };
  }
  const cursor = new RngCursor(streams, 'STARTS');
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swap = cursor.nextBelow(index + 1);
    [candidates[index], candidates[swap]] = [candidates[swap] as number, candidates[index] as number];
  }
  const starts: number[] = [];
  let attempts = 0;
  for (const cell of candidates) {
    if (starts.length === civCount || attempts >= WORLD_RULES.maxStartAttempts) break;
    attempts += 1;
    if (starts.some((other) => distance(map, other, cell) < WORLD_RULES.minStartSpacing)) {
      reject('startTooClose');
      continue;
    }
    starts.push(cell);
  }
  if (starts.length < civCount) {
    reject('startAttemptsExhausted');
    return { ok: false, cells: starts, attempts, rejections };
  }
  return { ok: true, cells: starts, attempts, rejections };
}
