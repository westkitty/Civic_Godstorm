// Presentation input for the world renderer. Built by the UI from the player's ObservationView and
// UI-local drafts only, so the renderer can never draw hidden truth. Plain data; no simulation access.

export interface WorldSnapshot {
  readonly width: number;
  readonly height: number;
  /** Per cell: 0 unknown, 1 remembered, 2 observed now. */
  readonly visibility: readonly number[];
  /** Per cell: last known biome index, -1 unknown. */
  readonly biome: readonly number[];
  readonly elevation: readonly number[];
  /** Per cell: owner of a known farm parcel, -1 none. */
  readonly farmOwner: readonly number[];
  readonly settlements: readonly { readonly cell: number; readonly ownerId: number; readonly own: boolean }[];
  readonly gods: readonly {
    readonly id: number;
    readonly own: boolean;
    readonly cells: readonly number[];
    readonly heading: number;
    /** Presentation of an own God's body; absent for foreign Gods (observation has no body data). */
    readonly body?: {
      readonly family: string;
      readonly size: 1 | 2 | 3;
      readonly pose: 'idle' | 'walk' | 'feed' | 'rest';
      readonly stage: 'juvenile' | 'prime' | 'ancient';
      readonly injured: boolean;
    };
  }[];
  readonly overlay: {
    readonly selectedGodCells: readonly number[];
    readonly routeAnchors: readonly number[];
    readonly routeSwept: readonly number[];
    readonly warningCells: readonly number[];
    readonly waypoints: readonly number[];
    readonly cursor: number | null;
  };
}

/** Presentation-only cell centre in world units (Section 16.2); floats never feed rules. */
export function cellCenter(width: number, cell: number): { x: number; z: number } {
  const c = cell % width;
  const r = Math.floor(cell / width);
  const q = c - (r - (r & 1)) / 2;
  return { x: 32 * (q + r / 2), z: 16 * Math.sqrt(3) * r };
}

/** Circumradius of a 32 U hex (Section 3.1). */
export const HEX_RADIUS = 32 / Math.sqrt(3);
