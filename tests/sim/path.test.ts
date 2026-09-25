import { describe, expect, it } from 'vitest';
import { initStreams, RngCursor } from '../../src/sim/core/rng.ts';
import { cellIndexOfOffset, neighbors, type MapDimensions } from '../../src/sim/world/hex.ts';
import { findPath } from '../../src/sim/world/path.ts';

/** Reference Dijkstra without a heuristic. */
function dijkstra(dims: MapDimensions, from: number, to: number, cost: (a: number, b: number) => number | null): number | null {
  const best = new Map<number, number>([[from, 0]]);
  const done = new Set<number>();
  for (;;) {
    let current = -1;
    let currentCost = Number.POSITIVE_INFINITY;
    for (const [cell, value] of best) {
      if (!done.has(cell) && value < currentCost) {
        current = cell;
        currentCost = value;
      }
    }
    if (current < 0) return null;
    if (current === to) return currentCost;
    done.add(current);
    for (const next of neighbors(dims, current)) {
      if (next < 0 || done.has(next)) continue;
      const step = cost(current, next);
      if (step === null) continue;
      if (currentCost + step < (best.get(next) ?? Number.POSITIVE_INFINITY)) best.set(next, currentCost + step);
    }
  }
}

describe('ordinary A*', () => {
  const dims: MapDimensions = { width: 12, height: 9 };

  it('matches exhaustive shortest-path costs on seeded random terrain', () => {
    const cursor = new RngCursor(initStreams('paths'), 'WORLD');
    for (let trial = 0; trial < 40; trial += 1) {
      const terrain = Array.from({ length: dims.width * dims.height }, () => cursor.nextBelow(5));
      const cost = (_: number, to: number): number | null => (terrain[to] === 0 ? null : terrain[to] === 4 ? 2 : 1);
      const from = cursor.nextBelow(terrain.length);
      const to = cursor.nextBelow(terrain.length);
      if (terrain[from] === 0 || terrain[to] === 0) continue;
      const result = findPath({ dims, from, to, stepCost: cost, minStepCost: 1, maxExpansions: 10_000 });
      const reference = dijkstra(dims, from, to, cost);
      if (reference === null) {
        expect(result.kind).toBe('NO_PATH');
      } else {
        expect(result.kind).toBe('FOUND');
        if (result.kind === 'FOUND') {
          expect(result.cost).toBe(reference);
          expect(result.cells[0]).toBe(from);
          expect(result.cells.at(-1)).toBe(to);
          const summed = result.cells.slice(1).reduce((sum, cell, i) => sum + (cost(result.cells[i] as number, cell) ?? 99), 0);
          expect(summed).toBe(reference);
        }
      }
    }
  });

  it('crosses the east-west seam when that is shorter', () => {
    const from = cellIndexOfOffset(dims, 0, 4);
    const to = cellIndexOfOffset(dims, dims.width - 2, 4);
    const result = findPath({ dims, from, to, stepCost: () => 1, minStepCost: 1, maxExpansions: 1000 });
    expect(result.kind === 'FOUND' && result.cost).toBe(2);
  });

  it('distinguishes an exhausted budget from an impossible route', () => {
    const from = cellIndexOfOffset(dims, 0, 0);
    const to = cellIndexOfOffset(dims, 6, 8);
    expect(findPath({ dims, from, to, stepCost: () => 1, minStepCost: 1, maxExpansions: 3 }).kind).toBe('BUDGET_EXCEEDED');
    const wall = new Set(Array.from({ length: dims.height }, (_, r) => [cellIndexOfOffset(dims, 3, r), cellIndexOfOffset(dims, 9, r)]).flat());
    const blocked = findPath({ dims, from, to, stepCost: (_, next) => (wall.has(next) ? null : 1), minStepCost: 1, maxExpansions: 10_000 });
    expect(blocked.kind).toBe('NO_PATH');
  });
});
