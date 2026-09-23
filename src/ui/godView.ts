// UI-side derivations from the player's ObservationView and local drafts: route previews, the
// world snapshot for rendering, and plain-language God status. Nothing here reads true state.

import type { Command, ConsentScope } from '../sim/core/commands.ts';
import { GOD_RULES } from '../sim/data/rules.ts';
import { evaluateTransition, occupiedCells } from '../sim/gods/body.ts';
import { apForFatigue, sizeRules, type FollowUp, type GodState, type RouteMode } from '../sim/gods/god.ts';
import { previewRoute, type RoutePlan, type RoutePreview } from '../sim/gods/planner.ts';
import { observedKnowledge, type ObservationView } from '../sim/observation/observation.ts';
import { offsetOfIndex } from '../sim/world/hex.ts';
import type { WorldSnapshot } from '../render/worldSnapshot.ts';

export interface TargetingState {
  readonly waypoints: readonly number[];
  readonly routeMode: RouteMode;
  readonly then: FollowUp;
  readonly consentGiven: boolean;
  readonly cursor: number | null;
}

export function ownGod(view: ObservationView): GodState | null {
  return view.ownGods.find((god) => god.lifecycle === 'ALIVE') ?? view.ownGods[0] ?? null;
}

export function cellLabel(view: ObservationView, cell: number): string {
  const { c, r } = offsetOfIndex(view.dims, cell);
  return `(${c}, ${r})`;
}

export function godCells(view: ObservationView, god: GodState): number[] {
  return occupiedCells(view.dims, god.maskName, god) ?? [];
}

export function computePreview(view: ObservationView, god: GodState, waypoints: readonly number[]): RoutePreview | null {
  if (waypoints.length === 0) return null;
  return previewRoute(observedKnowledge(view, god.id), god, waypoints);
}

/**
 * The route mode actually ordered. SAFE is only meaningful when the direct route needs consent and a
 * consent-free alternative exists; otherwise the displayed (and ordered) plan is the direct one.
 */
export function effectiveMode(preview: RoutePreview | null, requested: RouteMode): RouteMode {
  return requested === 'SAFE' && preview?.safe?.ok === true ? 'SAFE' : 'DIRECT';
}

/** The exact plan the validator will re-derive for the effective mode. */
export function chosenPlan(preview: RoutePreview | null, mode: RouteMode): RoutePlan | null {
  if (!preview) return null;
  const result = mode === 'SAFE' ? preview.safe : preview.direct;
  return result?.ok ? result : null;
}

export function needsConsent(plan: RoutePlan | null): boolean {
  return plan !== null && (plan.civilianCollateral.length > 0 || plan.trespass.length > 0);
}

function sweptAlong(view: ObservationView, god: GodState, plan: RoutePlan): number[] {
  const knowledge = observedKnowledge(view, god.id);
  const cells = new Set<number>();
  let pose = { anchor: god.anchor, heading: god.heading };
  for (const step of plan.steps) {
    const verdict = evaluateTransition(knowledge, god.ownerId, god.maskName, pose, step.action);
    if (verdict.ok) for (const cell of verdict.swept) cells.add(cell);
    pose = { anchor: step.anchor, heading: step.heading };
  }
  return [...cells];
}

export function buildWorldSnapshot(
  view: ObservationView,
  selected: boolean,
  targeting: TargetingState | null,
  plan: RoutePlan | null,
): WorldSnapshot {
  const o = view.observation;
  const god = ownGod(view);
  const foreign = new Map<number, number[]>();
  o.knownGod.forEach((godId, cell) => {
    if (godId < 0 || o.visibility[cell] !== 2 || view.ownGods.some((g) => g.id === godId)) return;
    foreign.set(godId, [...(foreign.get(godId) ?? []), cell]);
  });
  const settlements: WorldSnapshot['settlements'][number][] = [];
  o.knownSettlement.forEach((owner, cell) => {
    if (owner >= 0) settlements.push({ cell, ownerId: owner, own: owner === view.civId });
  });
  const activeRoute = plan ?? (god?.order.kind === 'MOVE' && god.status.kind === 'ACTIVE' ? { steps: god.order.plan.slice(god.order.progress) } : null);
  return {
    width: view.dims.width,
    height: view.dims.height,
    visibility: o.visibility,
    biome: o.knownBiome,
    elevation: o.knownElevation,
    farmOwner: o.knownFarm,
    settlements,
    gods: [
      ...view.ownGods.filter((g) => g.lifecycle === 'ALIVE').map((g) => ({ id: g.id, own: true, cells: godCells(view, g), heading: g.heading })),
      ...[...foreign].map(([id, cells]) => ({ id, own: false, cells, heading: 0 })),
    ],
    overlay: {
      selectedGodCells: selected && god ? godCells(view, god) : [],
      routeAnchors: activeRoute ? activeRoute.steps.map((step) => step.anchor) : [],
      routeSwept: plan && god ? sweptAlong(view, god, plan) : [],
      warningCells: plan ? [...plan.civilianCollateral, ...plan.trespass] : [],
      waypoints: targeting ? [...targeting.waypoints] : [],
      cursor: targeting?.cursor ?? null,
    },
  };
}

export interface GodStatusText {
  readonly order: string;
  readonly next: string;
  readonly destination: string;
  readonly arrival: string;
  readonly reserve: string;
  readonly fatigue: string;
  readonly health: string;
  readonly danger: string | null;
}

export function describeGod(view: ObservationView, god: GodState): GodStatusText {
  const size = sizeRules(god);
  const reserveTurns = Math.floor(god.reserve / (size.upkeep * 100));
  const apPerTurn = apForFatigue(god.fatigue);
  const order = god.order;
  let orderText = 'Holding position';
  let next = 'None';
  let destination = 'None';
  let arrival = 'Not moving';
  if (god.lifecycle === 'DEAD') orderText = 'Dead: living commands are unavailable';
  else if (order.kind === 'MOVE') {
    const dest = order.waypoints.at(-1);
    destination = dest === undefined ? 'None' : cellLabel(view, dest);
    next = order.then === null ? 'Hold on arrival' : `${order.then === 'FEED' ? 'Feed' : 'Rest'} on arrival`;
    if (god.status.kind === 'HALTED') {
      orderText = `Halted: ${god.status.reason.replaceAll('_', ' ').toLowerCase()}`;
      arrival = 'Awaiting new orders';
    } else if (god.status.kind === 'ACTIVE') {
      orderText = `Moving (step ${order.progress + 1} of ${order.plan.length})`;
      const remainingAp = order.plan.slice(order.progress).reduce((sum, step) => sum + step.ap, 0);
      arrival = apPerTurn === 0 ? 'Exhausted: rest first' : `About ${Math.max(1, Math.ceil(remainingAp / apPerTurn))} turn(s)`;
    } else {
      orderText = 'Arrived';
      arrival = 'Arrived';
    }
  } else if (order.kind === 'FEED') orderText = 'Feeding next turn';
  else if (order.kind === 'REST') orderText = 'Resting next turn';
  if (god.status.kind === 'HALTED' && order.kind !== 'MOVE') orderText = `Halted: ${god.status.reason.replaceAll('_', ' ').toLowerCase()}`;
  const danger = god.reserve < GOD_RULES.feedTurnsOfUpkeep * size.upkeep * 100
    ? `Nutrition runs out within two turns (${reserveTurns} turn(s) left). Order FEED on wild land.`
    : null;
  return {
    order: orderText,
    next,
    destination,
    arrival,
    reserve: `${(god.reserve / 100).toFixed(0)} of ${size.reserve} nutrition (about ${reserveTurns} turn(s) of upkeep)`,
    fatigue: `${god.fatigue} / 100 (${apPerTurn} AP per turn)`,
    health: `${god.vitalHealth} / ${size.health} vital; no serious wounds`,
    danger,
  };
}

export function describeDraft(view: ObservationView, command: Command): string {
  switch (command.kind) {
    case 'GOD_MOVE': {
      const dest = command.options.waypoints.at(-1);
      const via = command.options.waypoints.length > 1 ? ` via ${command.options.waypoints.length - 1} waypoint(s)` : '';
      const consent = (command.consent.civilianCollateral?.length ?? 0) + (command.consent.trespass?.length ?? 0);
      return `Move God to ${dest === undefined ? '?' : cellLabel(view, dest)}${via}, ${command.options.routeMode === 'SAFE' ? 'safe route' : 'direct route'}${consent > 0 ? `, consent given for ${consent} cell(s)` : ''}${command.options.then ? `, then ${command.options.then.toLowerCase()}` : ''}`;
    }
    case 'GOD_FEED':
      return 'God feeds where it stands';
    case 'GOD_REST':
      return 'God rests for the whole turn';
    case 'GOD_HOLD':
      return 'God holds position (itinerary cancelled)';
    case 'GOD_STANCE':
      return `God stance: ${command.options.stance.toLowerCase()}`;
    default:
      return command.kind;
  }
}

export function makeGodCommand(
  view: ObservationView,
  god: GodState,
  sequence: number,
  command:
    | { kind: 'GOD_MOVE'; options: { waypoints: readonly number[]; routeMode: RouteMode; then: FollowUp }; consent: ConsentScope }
    | { kind: 'GOD_FEED' | 'GOD_REST' | 'GOD_HOLD' }
    | { kind: 'GOD_STANCE'; options: { stance: GodState['stance'] } },
): Command {
  const base = {
    commandId: `h${view.turn + 1}-${sequence}`,
    civId: view.civId,
    actorId: god.id,
    issuedForTurn: view.turn + 1,
    sequence,
    target: null,
    expectedStateVersion: view.turn,
  };
  if (command.kind === 'GOD_MOVE') return { ...base, kind: 'GOD_MOVE', options: { ...command.options, waypoints: [...command.options.waypoints] }, consent: command.consent };
  if (command.kind === 'GOD_STANCE') return { ...base, kind: 'GOD_STANCE', options: command.options, consent: {} };
  return { ...base, kind: command.kind, options: {}, consent: {} };
}
