// Hex topology (master Sections 3.1, 16.2): pointy-top hexes, odd-row offset storage, axial
// coordinates, east-west wrap only. All functions are integer-exact.

export type MapSizeName = 'small' | 'standard' | 'large';

export interface MapDimensions {
  readonly width: number;
  readonly height: number;
}

export const MAP_SIZES: Readonly<Record<MapSizeName, MapDimensions>> = {
  small: { width: 48, height: 32 },
  standard: { width: 64, height: 40 },
  large: { width: 80, height: 48 },
};

export interface Axial {
  readonly q: number;
  readonly r: number;
}

export interface Offset {
  readonly c: number;
  readonly r: number;
}

/** Heading directions in axial order; heading 0 is +q (Section 16.2). */
export const HEADINGS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

const mod = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;

export function offsetToAxial(c: number, r: number): Axial {
  return { q: c - (r - (r & 1)) / 2, r };
}

export function axialToOffset(q: number, r: number): Offset {
  return { c: q + (r - (r & 1)) / 2, r };
}

export function isRowInside(dims: MapDimensions, r: number): boolean {
  return r >= 0 && r < dims.height;
}

/** Normalises the column by wrap; returns -1 for rows outside the map. */
export function cellIndexOfOffset(dims: MapDimensions, c: number, r: number): number {
  if (!isRowInside(dims, r)) return -1;
  return r * dims.width + mod(c, dims.width);
}

export function cellIndexOfAxial(dims: MapDimensions, q: number, r: number): number {
  const { c } = axialToOffset(q, r);
  return cellIndexOfOffset(dims, c, r);
}

export function offsetOfIndex(dims: MapDimensions, index: number): Offset {
  return { c: index % dims.width, r: Math.floor(index / dims.width) };
}

export function axialOfIndex(dims: MapDimensions, index: number): Axial {
  const { c, r } = offsetOfIndex(dims, index);
  return offsetToAxial(c, r);
}

/** Neighbour cell indices in heading order; -1 where the row leaves the map. */
export function neighbors(dims: MapDimensions, index: number): number[] {
  const { q, r } = axialOfIndex(dims, index);
  return HEADINGS.map((d) => cellIndexOfAxial(dims, q + d.q, r + d.r));
}

function axialDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/**
 * Wrapped hex distance: the shortest of the direct path and paths crossing either seam.
 * Shifting a cell by `width` columns within the same row shifts q by `width`.
 */
export function distance(dims: MapDimensions, from: number, to: number): number {
  const a = axialOfIndex(dims, from);
  const b = axialOfIndex(dims, to);
  return Math.min(
    axialDistance(a, b),
    axialDistance(a, { q: b.q + dims.width, r: b.r }),
    axialDistance(a, { q: b.q - dims.width, r: b.r }),
  );
}

/** Cells within `radius` steps (inclusive), deterministic ring-major order, no duplicates. */
export function cellsWithin(dims: MapDimensions, center: number, radius: number): number[] {
  const origin = axialOfIndex(dims, center);
  const seen = new Set<number>();
  const result: number[] = [];
  for (let dr = -radius; dr <= radius; dr += 1) {
    for (let dq = Math.max(-radius, -dr - radius); dq <= Math.min(radius, -dr + radius); dq += 1) {
      const index = cellIndexOfAxial(dims, origin.q + dq, origin.r + dr);
      if (index >= 0 && !seen.has(index)) {
        seen.add(index);
        result.push(index);
      }
    }
  }
  return result;
}

/** One 60-degree rotation of an axial offset: (q, r) -> (-r, q + r). */
export function rotateOnce(offset: Axial): Axial {
  return { q: 0 - offset.r, r: offset.q + offset.r };
}

export function rotate(offset: Axial, heading: number): Axial {
  let result = offset;
  for (let turn = 0; turn < mod(heading, 6); turn += 1) result = rotateOnce(result);
  return result;
}

/** Canonical heading-zero footprint masks (Section 16.2). */
export const MASKS = {
  TWO: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
  TRIANGLE: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }],
  RHOMBUS: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: 1, r: 1 }],
  FAN3: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: -1 }],
  FAN5: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: 1 }, { q: 1, r: -2 }],
  DISC7: [
    { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
  ],
} as const satisfies Record<string, readonly Axial[]>;

export type MaskName = keyof typeof MASKS;

/** Cells of a rigid mask at an anchor and heading; null if any cell leaves the map rows. */
export function footprintCells(dims: MapDimensions, mask: readonly Axial[], anchor: number, heading: number): number[] | null {
  const origin = axialOfIndex(dims, anchor);
  const cells: number[] = [];
  for (const offset of mask) {
    const rotated = rotate(offset, heading);
    const index = cellIndexOfAxial(dims, origin.q + rotated.q, origin.r + rotated.r);
    if (index < 0) return null;
    cells.push(index);
  }
  return cells;
}
