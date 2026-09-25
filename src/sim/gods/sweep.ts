// Exact swept-region geometry (master Section 16.2). A rigid move or turn validates the union of the
// old and new masks plus every cell whose hexagon has positive-area overlap with the planar convex
// hull of the old and new cell polygons. All arithmetic is integer: pointy-top hexes are mapped by
// the affine transform X = 2q + r, Y = 3r, which preserves convexity and intersection.

import { HEADINGS, rotate, type Axial } from '../world/hex.ts';

type Point = readonly [number, number];

const HEX_VERTEX_OFFSETS: readonly Point[] = [[1, 1], [0, 2], [-1, 1], [-1, -1], [0, -2], [1, -1]];

function hexPolygon(cell: Axial): Point[] {
  const x = 2 * cell.q + cell.r;
  const y = 3 * cell.r;
  return HEX_VERTEX_OFFSETS.map(([dx, dy]) => [x + dx, y + dy] as const);
}

const cross = (o: Point, a: Point, b: Point): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Andrew's monotone chain; returns the hull counter-clockwise without collinear points. */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as Point, lower[lower.length - 1] as Point, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index] as Point;
    while (upper.length >= 2 && cross(upper[upper.length - 2] as Point, upper[upper.length - 1] as Point, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function axesOf(polygon: readonly Point[]): Point[] {
  return polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length] as Point;
    return [point[1] - next[1], next[0] - point[0]] as const;
  });
}

/** Separating-axis test for positive-area overlap of two convex polygons (touching is not overlap). */
export function overlapsWithArea(a: readonly Point[], b: readonly Point[]): boolean {
  for (const [nx, ny] of [...axesOf(a), ...axesOf(b)]) {
    let minA = Number.POSITIVE_INFINITY;
    let maxA = Number.NEGATIVE_INFINITY;
    for (const [x, y] of a) {
      const projection = x * nx + y * ny;
      minA = Math.min(minA, projection);
      maxA = Math.max(maxA, projection);
    }
    let minB = Number.POSITIVE_INFINITY;
    let maxB = Number.NEGATIVE_INFINITY;
    for (const [x, y] of b) {
      const projection = x * nx + y * ny;
      minB = Math.min(minB, projection);
      maxB = Math.max(maxB, projection);
    }
    if (maxA <= minB || maxB <= minA) return false;
  }
  return true;
}

const key = (cell: Axial): string => `${cell.q},${cell.r}`;

/** Relative swept cells (axial offsets from the pre-move anchor) for a set of old and new cells. */
export function sweptOffsets(oldCells: readonly Axial[], newCells: readonly Axial[]): Axial[] {
  const occupied = [...oldCells, ...newCells];
  const hull = convexHull(occupied.flatMap(hexPolygon));
  const result = new Map<string, Axial>();
  for (const cell of occupied) result.set(key(cell), { q: cell.q, r: cell.r });
  for (const cell of occupied) {
    for (let dq = -2; dq <= 2; dq += 1) {
      for (let dr = -2; dr <= 2; dr += 1) {
        const candidate = { q: cell.q + dq, r: cell.r + dr };
        if (result.has(key(candidate))) continue;
        if (overlapsWithArea(hexPolygon(candidate), hull)) result.set(key(candidate), candidate);
      }
    }
  }
  return [...result.values()].sort((a, b) => a.r - b.r || a.q - b.q);
}

export type BodyAction = 'FORWARD' | 'TURN_LEFT' | 'TURN_RIGHT';

export interface Transition {
  /** Anchor displacement in axial coordinates. */
  readonly anchorDelta: Axial;
  readonly newHeading: number;
  /** New occupied cells relative to the old anchor. */
  readonly occupied: readonly Axial[];
  /** Swept cells relative to the old anchor (includes old and new occupancy). */
  readonly swept: readonly Axial[];
  /** Cells newly entered by the move (occupied now, not before), relative to the old anchor. */
  readonly entered: readonly Axial[];
}

const transitionCache = new Map<string, Transition>();

/** Translation-invariant transition geometry for a rigid mask, cached per (mask, heading, action). */
export function transitionFor(maskName: string, mask: readonly Axial[], heading: number, action: BodyAction): Transition {
  const cacheKey = `${maskName}:${heading}:${action}`;
  const cached = transitionCache.get(cacheKey);
  if (cached) return cached;
  const newHeading = action === 'TURN_LEFT' ? (heading + 5) % 6 : action === 'TURN_RIGHT' ? (heading + 1) % 6 : heading;
  const anchorDelta = action === 'FORWARD' ? (HEADINGS[heading] as Axial) : { q: 0, r: 0 };
  const oldCells = mask.map((offset) => rotate(offset, heading));
  const newCells = mask.map((offset) => {
    const turned = rotate(offset, newHeading);
    return { q: turned.q + anchorDelta.q, r: turned.r + anchorDelta.r };
  });
  const oldKeys = new Set(oldCells.map(key));
  const transition: Transition = {
    anchorDelta,
    newHeading,
    occupied: newCells,
    swept: sweptOffsets(oldCells, newCells),
    entered: newCells.filter((cell) => !oldKeys.has(key(cell))),
  };
  transitionCache.set(cacheKey, transition);
  return transition;
}
