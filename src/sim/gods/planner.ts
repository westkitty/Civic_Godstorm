// God route planning and previews (master Sections 4.4, 14.3, 16.2). Footprint A* over
// (anchor, heading) using only a civilization's Knowledge. SAFE routes avoid every cell needing
// consent; DIRECT routes may cross them and report exactly which consent they need. A node-expansion
// cap yields BUDGET_EXCEEDED, never NO_PATH.

import { GOD_RULES } from '../data/rules.ts';
import { distance } from '../world/hex.ts';
import { OpenSet } from '../world/path.ts';
import { evaluateTransition, type Knowledge, type Pose } from './body.ts';
import { apForFatigue, type PlanStep, type RouteMode } from './god.ts';
import type { BodyAction } from './sweep.ts';

const ACTIONS: readonly BodyAction[] = ['FORWARD', 'TURN_LEFT', 'TURN_RIGHT'];

export type RouteFailure = 'NO_PATH' | 'BUDGET_EXCEEDED' | 'WRONG_DOMAIN' | 'TOO_MANY_WAYPOINTS' | 'EMPTY';

export interface RoutePlan {
  readonly ok: true;
  readonly steps: PlanStep[];
  readonly totalAp: number;
  readonly civilianCollateral: number[];
  readonly trespass: number[];
  readonly uncertain: number[];
  readonly expanded: number;
}

export type RouteResult = RoutePlan | { readonly ok: false; readonly failure: RouteFailure; readonly waypointIndex: number; readonly expanded: number };

interface Node {
  readonly pose: Pose;
  readonly g: number;
}

const poseKey = (pose: Pose): number => pose.anchor * 6 + pose.heading;
const unique = (cells: Iterable<number>): number[] => [...new Set(cells)].sort((a, b) => a - b);

function planSegment(
  knowledge: Knowledge,
  ownerId: number,
  maskName: string,
  start: Pose,
  goal: number,
  mode: RouteMode,
  budget: number,
): { steps: PlanStep[]; expanded: number } | { failure: 'NO_PATH' | 'BUDGET_EXCEEDED'; expanded: number } {
  if (start.anchor === goal) return { steps: [], expanded: 0 };
  const weight = GOD_RULES.plannerApWeight;
  const heuristic = (anchor: number): number => distance(knowledge.dims, anchor, goal) * weight;
  const best = new Map<number, Node>([[poseKey(start), { pose: start, g: 0 }]]);
  const cameFrom = new Map<number, { key: number; step: PlanStep }>();
  const closed = new Set<number>();
  const open = new OpenSet();
  open.push({ f: heuristic(start.anchor), h: heuristic(start.anchor), cell: poseKey(start) });
  let expanded = 0;
  while (open.size > 0) {
    const item = open.pop();
    if (!item || closed.has(item.cell)) continue;
    const node = best.get(item.cell) as Node;
    if (node.pose.anchor === goal) {
      const steps: PlanStep[] = [];
      let key = item.cell;
      while (cameFrom.has(key)) {
        const link = cameFrom.get(key) as { key: number; step: PlanStep };
        steps.push(link.step);
        key = link.key;
      }
      return { steps: steps.reverse(), expanded };
    }
    if (expanded >= budget) return { failure: 'BUDGET_EXCEEDED', expanded };
    expanded += 1;
    closed.add(item.cell);
    for (const action of ACTIONS) {
      const verdict = evaluateTransition(knowledge, ownerId, maskName, node.pose, action);
      if (!verdict.ok) continue;
      if (mode === 'SAFE' && (verdict.consent.civilianCollateral.length > 0 || verdict.consent.trespass.length > 0)) continue;
      const key = poseKey(verdict.pose);
      if (closed.has(key)) continue;
      const g = node.g + verdict.ap * weight + (action === 'FORWARD' ? 0 : 1);
      const known = best.get(key);
      if (known && known.g <= g) continue;
      best.set(key, { pose: verdict.pose, g });
      cameFrom.set(key, { key: item.cell, step: { action, anchor: verdict.pose.anchor, heading: verdict.pose.heading, ap: verdict.ap } });
      const h = heuristic(verdict.pose.anchor);
      open.push({ f: g + h, h, cell: key });
    }
  }
  return { failure: 'NO_PATH', expanded };
}

/** Plans through up to twelve waypoints in order. */
export function planRoute(
  knowledge: Knowledge,
  ownerId: number,
  maskName: string,
  start: Pose,
  waypoints: readonly number[],
  mode: RouteMode,
  budget: number = GOD_RULES.plannerMaxExpansions,
): RouteResult {
  if (waypoints.length === 0) return { ok: false, failure: 'EMPTY', waypointIndex: -1, expanded: 0 };
  if (waypoints.length > GOD_RULES.maxWaypoints) return { ok: false, failure: 'TOO_MANY_WAYPOINTS', waypointIndex: GOD_RULES.maxWaypoints, expanded: 0 };
  const steps: PlanStep[] = [];
  let pose = start;
  let expanded = 0;
  for (const [index, waypoint] of waypoints.entries()) {
    const segment = planSegment(knowledge, ownerId, maskName, pose, waypoint, mode, budget - expanded);
    expanded += segment.expanded;
    if ('failure' in segment) return { ok: false, failure: segment.failure, waypointIndex: index, expanded };
    steps.push(...segment.steps);
    const last = segment.steps.at(-1);
    if (last) pose = { anchor: last.anchor, heading: last.heading };
  }
  // Re-evaluate the final plan once to report consent needs and uncertainty along it.
  const collateral: number[] = [];
  const trespass: number[] = [];
  const uncertain: number[] = [];
  let cursor = start;
  for (const step of steps) {
    const verdict = evaluateTransition(knowledge, ownerId, maskName, cursor, step.action);
    if (verdict.ok) {
      collateral.push(...verdict.consent.civilianCollateral);
      trespass.push(...verdict.consent.trespass);
      uncertain.push(...verdict.uncertain);
    }
    cursor = { anchor: step.anchor, heading: step.heading };
  }
  return {
    ok: true,
    steps,
    totalAp: steps.reduce((sum, step) => sum + step.ap, 0),
    civilianCollateral: unique(collateral),
    trespass: unique(trespass),
    uncertain: unique(uncertain),
    expanded,
  };
}

export interface RoutePreview {
  readonly direct: RouteResult;
  /** Present when the direct route needs consent: the best route that needs none, if one exists. */
  readonly safe: RouteResult | null;
  /** Certain own-state costs versus estimates through unobserved cells (Section 4.4). */
  readonly estimate: {
    readonly apPerTurn: number;
    readonly turns: number;
    readonly movementNutrition: number;
    readonly throughUnknownCells: number;
  } | null;
}

export function previewRoute(
  knowledge: Knowledge,
  god: { readonly ownerId: number; readonly maskName: string; readonly anchor: number; readonly heading: number; readonly fatigue: number },
  waypoints: readonly number[],
): RoutePreview {
  const start = { anchor: god.anchor, heading: god.heading };
  const direct = planRoute(knowledge, god.ownerId, god.maskName, start, waypoints, 'DIRECT');
  const needsConsent = direct.ok && (direct.civilianCollateral.length > 0 || direct.trespass.length > 0);
  const safe = needsConsent ? planRoute(knowledge, god.ownerId, god.maskName, start, waypoints, 'SAFE') : null;
  const apPerTurn = apForFatigue(god.fatigue);
  const estimate = direct.ok
    ? {
        apPerTurn,
        turns: apPerTurn === 0 ? -1 : Math.ceil(direct.totalAp / apPerTurn),
        movementNutrition: direct.totalAp,
        throughUnknownCells: direct.uncertain.length,
      }
    : null;
  return { direct, safe, estimate };
}
