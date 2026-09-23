// Shared God-body legality (master Sections 4.3, 4.4, 16.2, 16.3). The same evaluation runs against
// true state during resolution and against a civilization's observation during planning, through the
// Knowledge interface, so planning can never consult hidden truth.

import { BIOME_INDEX, GOD_RULES } from '../data/rules.ts';
import { axialOfIndex, cellIndexOfAxial, MASKS, rotate, type MapDimensions, type MaskName } from '../world/hex.ts';
import { transitionFor, type BodyAction } from './sweep.ts';

export interface CellKnowledge {
  /** False when the planner has never observed the cell (costs and hazards are estimates). */
  readonly known: boolean;
  readonly biome: number;
  readonly elevation: number;
  /** Owner of a settlement core at this cell, or null. */
  readonly settlementOwner: number | null;
  /** Owner of a farm parcel at this cell, or null. */
  readonly farmOwner: number | null;
  /** Another God body occupying the cell (not the moving God). */
  readonly otherGod: boolean;
  /** Owner of a settlement core within one step (claim ring), other than none. */
  readonly claimOwners: readonly number[];
}

export interface Knowledge {
  readonly dims: MapDimensions;
  cell(index: number): CellKnowledge;
}

export interface Pose {
  readonly anchor: number;
  readonly heading: number;
}

export interface ConsentNeeds {
  readonly civilianCollateral: number[];
  readonly trespass: number[];
}

export type TransitionVerdict =
  | {
      readonly ok: true;
      readonly pose: Pose;
      readonly ap: number;
      readonly occupied: number[];
      readonly swept: number[];
      readonly entered: number[];
      readonly consent: ConsentNeeds;
      readonly uncertain: number[];
    }
  | { readonly ok: false; readonly code: 'BODY_BLOCKED' | 'WRONG_DOMAIN'; readonly reason: string; readonly cells: number[] };

function toCells(dims: MapDimensions, anchor: number, offsets: readonly { q: number; r: number }[]): number[] | null {
  const origin = axialOfIndex(dims, anchor);
  const cells: number[] = [];
  for (const offset of offsets) {
    const index = cellIndexOfAxial(dims, origin.q + offset.q, origin.r + offset.r);
    if (index < 0) return null;
    cells.push(index);
  }
  return cells;
}

export function occupiedCells(dims: MapDimensions, maskName: string, pose: Pose): number[] | null {
  const mask = MASKS[maskName as MaskName];
  return toCells(dims, pose.anchor, mask.map((offset) => rotate(offset, pose.heading)));
}

/** PILLAR surface costs: land 1; forest or hill 2; shallow ford 2; deep water illegal. */
export function surfaceCost(info: CellKnowledge): number | null {
  if (!info.known) return 1;
  if (info.biome === BIOME_INDEX.DEEP_SEA) return null;
  if (info.biome === BIOME_INDEX.COAST_SHALLOW) return 2;
  const forest = info.biome === BIOME_INDEX.WOODLAND || info.biome === BIOME_INDEX.BOREAL || info.biome === BIOME_INDEX.VOLCANIC_UPLAND;
  return forest || info.elevation >= GOD_RULES.hillElevation ? 2 : 1;
}

/**
 * Evaluates one body action from a pose. Occupied cells must be a legal domain; swept cells must be
 * free of settlement cores and other God bodies. Farm parcels and foreign claims in the swept region
 * require scoped consent (reported, not refused, here).
 */
export function evaluateTransition(
  knowledge: Knowledge,
  ownerId: number,
  maskName: string,
  pose: Pose,
  action: BodyAction,
): TransitionVerdict {
  const { dims } = knowledge;
  const transition = transitionFor(maskName, MASKS[maskName as MaskName], pose.heading, action);
  const occupied = toCells(dims, pose.anchor, transition.occupied);
  const swept = toCells(dims, pose.anchor, transition.swept);
  const entered = toCells(dims, pose.anchor, transition.entered);
  if (!occupied || !swept || !entered) return { ok: false, code: 'BODY_BLOCKED', reason: 'MAP_EDGE', cells: [] };
  const origin = axialOfIndex(dims, pose.anchor);
  const anchor = cellIndexOfAxial(dims, origin.q + transition.anchorDelta.q, origin.r + transition.anchorDelta.r);

  const blocked = swept.filter((cell) => {
    const info = knowledge.cell(cell);
    return info.settlementOwner !== null || info.otherGod;
  });
  if (blocked.length > 0) return { ok: false, code: 'BODY_BLOCKED', reason: 'SETTLEMENT_OR_BODY', cells: blocked };

  let ap = 0;
  for (const cell of entered) {
    const cost = surfaceCost(knowledge.cell(cell));
    if (cost === null) return { ok: false, code: 'WRONG_DOMAIN', reason: 'DEEP_WATER', cells: [cell] };
    ap = Math.max(ap, cost);
  }
  const deep = occupied.filter((cell) => surfaceCost(knowledge.cell(cell)) === null);
  if (deep.length > 0) return { ok: false, code: 'WRONG_DOMAIN', reason: 'DEEP_WATER', cells: deep };

  const civilianCollateral = swept.filter((cell) => knowledge.cell(cell).farmOwner !== null);
  const trespass = swept.filter((cell) => knowledge.cell(cell).claimOwners.some((owner) => owner !== ownerId));
  return {
    ok: true,
    pose: { anchor, heading: transition.newHeading },
    ap: action === 'FORWARD' ? ap : 0,
    occupied,
    swept,
    entered,
    consent: { civilianCollateral, trespass },
    uncertain: swept.filter((cell) => !knowledge.cell(cell).known),
  };
}
