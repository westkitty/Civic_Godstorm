import { describe, expect, it } from 'vitest';
import { createCampaign, WorldGenerationError } from '../../src/sim/campaign.ts';
import { canonicalHash } from '../../src/sim/core/canonical.ts';
import { initStreams } from '../../src/sim/core/rng.ts';
import { BIOME_INDEX, WORLD_RULES } from '../../src/sim/data/rules.ts';
import { checkStartSite, generateMap, isWater, placeStarts } from '../../src/sim/world/generate.ts';
import { distance, neighbors } from '../../src/sim/world/hex.ts';

describe('world generation', () => {
  it('is a pure function of seed and size', () => {
    expect(canonicalHash(generateMap('standard', 'w-1'))).toBe(canonicalHash(generateMap('standard', 'w-1')));
    expect(canonicalHash(generateMap('standard', 'w-1'))).not.toBe(canonicalHash(generateMap('standard', 'w-2')));
  });

  it('keeps every field in its declared integer range', () => {
    for (const size of ['small', 'standard', 'large'] as const) {
      const map = generateMap(size, `range-${size}`);
      const cells = map.width * map.height;
      for (const field of [map.elevation, map.biome, map.temperature, map.moisture, map.fertility, map.biomass, map.biomassCapacity, map.stoneReserve]) {
        expect(field).toHaveLength(cells);
        expect(field.every((value) => Number.isSafeInteger(value) && value >= 0)).toBe(true);
      }
      expect(map.elevation.every((value) => value <= 255)).toBe(true);
      expect(map.fertility.every((value) => value <= 1000)).toBe(true);
      expect(map.biome.every((value) => value < 9)).toBe(true);
      expect(map.fertility.every((value, cell) => !isWater(map, cell) || value === 0)).toBe(true);
    }
  });

  it('places starts that satisfy site rules, spacing and the guaranteed opening', () => {
    for (let i = 0; i < 10; i += 1) {
      const state = createCampaign({ seed: `starts-${i}`, size: 'standard', civCount: 6 });
      expect(state.settlements).toHaveLength(6);
      for (const settlement of state.settlements) {
        expect(checkStartSite(state.map, settlement.cell).ok).toBe(true);
        expect(settlement.farmSites.map((site) => state.map.fertility[site.cell])).toEqual([1000, 1000]);
        for (const site of settlement.farmSites) expect(neighbors(state.map, settlement.cell)).toContain(site.cell);
        for (const other of state.settlements) {
          if (other !== settlement) expect(distance(state.map, other.cell, settlement.cell)).toBeGreaterThanOrEqual(WORLD_RULES.minStartSpacing);
        }
      }
      expect(state.generation.startAttempts).toBeLessThanOrEqual(WORLD_RULES.maxStartAttempts);
    }
  });

  it('reports named rejections instead of looping when no start exists', () => {
    const map = generateMap('small', 'water-world');
    map.biome = map.biome.map(() => BIOME_INDEX.DEEP_SEA);
    const placement = placeStarts(map, 2, initStreams('water-world'));
    expect(placement.ok).toBe(false);
    expect(placement.rejections).toEqual({ tooFewCandidateSites: 1 });
    expect(() => createCampaign({ seed: 'x', size: 'small', civCount: 7 })).toThrow(RangeError);
    expect(new WorldGenerationError('s', { a: 1 }).rejections).toEqual({ a: 1 });
  });
});
