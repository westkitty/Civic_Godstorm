import { describe, expect, it } from 'vitest';
import {
  axialOfIndex,
  axialToOffset,
  cellIndexOfAxial,
  cellIndexOfOffset,
  cellsWithin,
  distance,
  footprintCells,
  HEADINGS,
  MAP_SIZES,
  MASKS,
  neighbors,
  offsetToAxial,
  rotate,
  type MapDimensions,
} from '../../src/sim/world/hex.ts';

/** Reference distance: breadth-first search over the neighbour relation. */
function bfsDistances(dims: MapDimensions, from: number): number[] {
  const result = new Array<number>(dims.width * dims.height).fill(-1);
  result[from] = 0;
  const queue = [from];
  while (queue.length > 0) {
    const cell = queue.shift() as number;
    for (const next of neighbors(dims, cell)) {
      if (next >= 0 && result[next] === -1) {
        result[next] = (result[cell] as number) + 1;
        queue.push(next);
      }
    }
  }
  return result;
}

describe('offset/axial coordinates', () => {
  it('round-trips every cell of every map size', () => {
    for (const dims of Object.values(MAP_SIZES)) {
      for (let index = 0; index < dims.width * dims.height; index += 1) {
        const { q, r } = axialOfIndex(dims, index);
        const { c } = axialToOffset(q, r);
        expect(cellIndexOfOffset(dims, c, r)).toBe(index);
        expect(cellIndexOfAxial(dims, q, r)).toBe(index);
        expect(offsetToAxial(c, r)).toEqual({ q, r });
      }
    }
  });

  it('wraps columns east-west but never rows', () => {
    const dims = MAP_SIZES.small;
    expect(cellIndexOfOffset(dims, -1, 5)).toBe(5 * dims.width + dims.width - 1);
    expect(cellIndexOfOffset(dims, dims.width, 5)).toBe(5 * dims.width);
    expect(cellIndexOfOffset(dims, 3, -1)).toBe(-1);
    expect(cellIndexOfOffset(dims, 3, dims.height)).toBe(-1);
  });
});

describe('neighbours and wrapped distance', () => {
  const dims: MapDimensions = { width: 12, height: 8 };

  it('gives six distinct neighbours at distance 1, fewer only at top/bottom rows', () => {
    for (let index = 0; index < dims.width * dims.height; index += 1) {
      const adjacent = neighbors(dims, index).filter((n) => n >= 0);
      const row = Math.floor(index / dims.width);
      expect(adjacent.length).toBe(row === 0 || row === dims.height - 1 ? 4 : 6);
      expect(new Set(adjacent).size).toBe(adjacent.length);
      for (const n of adjacent) {
        expect(distance(dims, index, n)).toBe(1);
        expect(neighbors(dims, n)).toContain(index);
      }
    }
  });

  it('equals breadth-first distance everywhere, including across the seam', () => {
    for (let from = 0; from < dims.width * dims.height; from += 7) {
      const reference = bfsDistances(dims, from);
      for (let to = 0; to < dims.width * dims.height; to += 1) {
        expect(distance(dims, from, to)).toBe(reference[to]);
      }
    }
  });

  it('takes the short way round the cylinder', () => {
    const big = MAP_SIZES.standard;
    const west = cellIndexOfOffset(big, 0, 10);
    const east = cellIndexOfOffset(big, big.width - 1, 10);
    expect(distance(big, west, east)).toBe(1);
  });

  it('enumerates rings without duplicates', () => {
    const cells = cellsWithin(dims, cellIndexOfOffset(dims, 0, 4), 2);
    expect(cells.length).toBe(19);
    expect(new Set(cells).size).toBe(19);
    for (const cell of cells) expect(distance(dims, cellIndexOfOffset(dims, 0, 4), cell)).toBeLessThanOrEqual(2);
  });
});

describe('footprint masks', () => {
  it('have the declared sizes and include the anchor', () => {
    expect(Object.fromEntries(Object.entries(MASKS).map(([name, mask]) => [name, mask.length])))
      .toEqual({ TWO: 2, TRIANGLE: 3, RHOMBUS: 4, FAN3: 3, FAN5: 5, DISC7: 7 });
    for (const mask of Object.values(MASKS)) expect(mask[0]).toEqual({ q: 0, r: 0 });
  });

  it('rotate six times back to identity and heading 1 maps +q to heading 1', () => {
    expect(rotate(HEADINGS[0] as { q: number; r: number }, 1)).toEqual(HEADINGS[1]);
    for (const mask of Object.values(MASKS)) {
      for (const offset of mask) {
        const turned = rotate(offset, 6);
        expect(turned).toEqual(offset);
      }
    }
  });

  it('keeps footprints contiguous and distinct in all headings at both seams', () => {
    const big = MAP_SIZES.standard;
    const anchors = [cellIndexOfOffset(big, 0, 10), cellIndexOfOffset(big, big.width - 1, 11)];
    for (const mask of Object.values(MASKS)) {
      for (const anchor of anchors) {
        for (let heading = 0; heading < 6; heading += 1) {
          const cells = footprintCells(big, mask, anchor, heading);
          expect(cells).not.toBeNull();
          expect(new Set(cells).size).toBe(mask.length);
          for (const cell of cells ?? []) {
            if (cell === anchor) continue;
            expect((cells ?? []).some((other) => other !== cell && distance(big, cell, other) === 1)).toBe(true);
          }
        }
      }
    }
  });

  it('rejects a footprint leaving the map rows', () => {
    const big = MAP_SIZES.standard;
    expect(footprintCells(big, MASKS.DISC7, cellIndexOfOffset(big, 5, 0), 0)).toBeNull();
  });
});
