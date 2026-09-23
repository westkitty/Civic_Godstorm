// God resolution (master Sections 2.2 steps 4-5, 2.3, 4.5, 4.6, 16.1, 16.4). Four impulses, at most
// two AP and two edge crossings per impulse. Within an impulse, Gods advance in simultaneous
// micro-slots: every moving God proposes its next step against the same positions; intersecting
// proposals halt both Gods at their last legal pose. Movement stops before unconsented harm and at
// newly observed obstacles; it never re-plans with hidden knowledge.

import { canonicalize } from '../core/canonical.ts';
import type { CampaignState, GodTurnSummary } from '../core/state.ts';
import { GOD_RULES } from '../data/rules.ts';
import { buildObservationView, observedKnowledge, truthKnowledge, updateObservation } from '../observation/observation.ts';
import { distance } from '../world/hex.ts';
import { evaluateTransition, occupiedCells, type TransitionVerdict } from './body.ts';
import { consentCovers } from './commands.ts';
import { apForFatigue, sizeRules, type GodState, type MoveOrder } from './god.ts';

interface TurnContext {
  apRemaining: number;
  apSpent: number;
  movementAp: number;
  firstForwardDone: boolean;
  steps: number;
  fed: boolean;
  rested: boolean;
  nutritionGained: number;
  disturbed: Set<number>;
  halted: string | null;
  completedThisTurn: boolean;
}

interface Proposal {
  readonly god: GodState;
  readonly verdict: Extract<TransitionVerdict, { ok: true }>;
  /** True for a completed forward step. */
  readonly forward: boolean;
  /** True when the body actually changes pose this slot (turn or completed forward step). */
  readonly moves: boolean;
  readonly apToPay: number;
}

function halt(god: GodState, ctx: TurnContext, turn: number, reason: string, cells: number[]): void {
  god.status = { kind: 'HALTED', turn, reason, cells };
  ctx.halted = reason;
}

function feed(state: CampaignState, god: GodState, ctx: TurnContext): void {
  const size = sizeRules(god);
  const cells = occupiedCells(state.map, god.maskName, god) ?? [];
  const farms = new Set(state.settlements.flatMap((s) => s.farmSites.map((f) => f.cell)));
  const foreignClaims = new Set(state.settlements.filter((s) => s.ownerId !== god.ownerId).map((s) => s.cell));
  // BROWSE feeding zone: wild plant biomass under the body, excluding farm parcels and foreign claims.
  const zone = cells.filter((cell) => !farms.has(cell)
    && ![...foreignClaims].some((core) => distance(state.map, core, cell) <= 1));
  const room = size.reserve * 100 - god.reserve;
  const wanted = Math.min(GOD_RULES.feedTurnsOfUpkeep * size.upkeep * 100, room);
  let units = Math.floor(wanted / GOD_RULES.biomassPerNutrition);
  let taken = 0;
  for (const cell of zone) {
    if (units <= 0) break;
    const take = Math.min(units, state.map.biomass[cell] as number);
    state.map.biomass[cell] = (state.map.biomass[cell] as number) - take;
    units -= take;
    taken += take;
  }
  const gained = taken * GOD_RULES.biomassPerNutrition;
  god.reserve += gained;
  ctx.nutritionGained += gained;
  ctx.fed = true;
}

function disturb(state: CampaignState, god: GodState, cells: readonly number[]): void {
  const base = GOD_RULES.passageDisturbancePerMass * sizeRules(god).mass;
  const amount = god.stance === 'CAREFUL' ? Math.floor(base / 2) : god.stance === 'FORCEFUL' ? Math.floor((base * 3) / 2) : base;
  for (const cell of cells) state.map.soilDisturbance[cell] = Math.min(1000, (state.map.soilDisturbance[cell] as number) + amount);
}

/** The next step a God wants to take this micro-slot, or a reason it cannot (null = nothing to do now). */
function propose(state: CampaignState, god: GodState, ctx: TurnContext, impulseAp: number, crossings: number): Proposal | { halt: string; cells: number[] } | null {
  const order = god.order;
  if (order.kind !== 'MOVE' || god.status.kind !== 'ACTIVE' || order.progress >= order.plan.length) return null;
  const step = order.plan[order.progress];
  if (!step) return null;
  const verdict = evaluateTransition(truthKnowledge(state, god.id), god.ownerId, god.maskName, god, step.action);
  if (!verdict.ok) return { halt: verdict.code === 'WRONG_DOMAIN' ? 'WRONG_DOMAIN' : 'BODY_BLOCKED', cells: verdict.cells };
  if (!consentCovers(order.consent, { civilianCollateral: verdict.consent.civilianCollateral, trespass: verdict.consent.trespass })) {
    return { halt: 'CONSENT_REQUIRED', cells: [...verdict.consent.civilianCollateral, ...verdict.consent.trespass] };
  }
  if (step.action !== 'FORWARD') return { god, verdict, forward: false, moves: true, apToPay: 0 };
  if (crossings >= GOD_RULES.maxCrossingsPerImpulse) return null;
  const cost = verdict.ap + (god.stance === 'CAREFUL' && !ctx.firstForwardDone ? 1 : 0);
  const pay = Math.min(cost - order.stepApPaid, impulseAp, ctx.apRemaining);
  if (pay <= 0) return null;
  const completes = order.stepApPaid + pay >= cost;
  return { god, verdict, forward: completes, moves: completes, apToPay: pay };
}

/** After a step and a fresh observation, stop if the rest of the route is now known to be illegal. */
function newlyObservedObstacle(state: CampaignState, god: GodState, order: MoveOrder): number[] | null {
  const knowledge = observedKnowledge(buildObservationView(state, god.ownerId), god.id);
  let pose = { anchor: god.anchor, heading: god.heading };
  for (let index = order.progress; index < order.plan.length; index += 1) {
    const step = order.plan[index];
    if (!step) break;
    const verdict = evaluateTransition(knowledge, god.ownerId, god.maskName, pose, step.action);
    if (!verdict.ok) return verdict.cells;
    if (!consentCovers(order.consent, verdict.consent)) return [...verdict.consent.civilianCollateral, ...verdict.consent.trespass];
    pose = verdict.pose;
  }
  return null;
}

export function resolveGods(state: CampaignState): GodTurnSummary[] {
  const gods = state.gods.filter((g) => g.lifecycle === 'ALIVE').sort((a, b) => a.id - b.id);
  const contexts = new Map<number, TurnContext>();
  for (const god of gods) {
    const exhausted = apForFatigue(god.fatigue) === 0;
    contexts.set(god.id, {
      apRemaining: god.order.kind === 'REST' ? 0 : exhausted && god.order.kind === 'FEED' ? GOD_RULES.feedAp : apForFatigue(god.fatigue),
      apSpent: 0,
      movementAp: 0,
      firstForwardDone: false,
      steps: 0,
      fed: false,
      rested: god.order.kind === 'REST',
      nutritionGained: 0,
      disturbed: new Set(),
      halted: null,
      completedThisTurn: false,
    });
  }

  for (let impulse = 1; impulse <= GOD_RULES.impulses; impulse += 1) {
    const impulseAp = new Map(gods.map((g) => [g.id, Math.min(GOD_RULES.maxApPerImpulse, contexts.get(g.id)?.apRemaining ?? 0)]));
    const crossings = new Map(gods.map((g) => [g.id, 0]));

    // One-shot FEED order executes at the first impulse with two AP.
    for (const god of gods) {
      const ctx = contexts.get(god.id) as TurnContext;
      if (god.order.kind === 'FEED' && !ctx.fed && (impulseAp.get(god.id) ?? 0) >= GOD_RULES.feedAp) {
        impulseAp.set(god.id, (impulseAp.get(god.id) ?? 0) - GOD_RULES.feedAp);
        ctx.apRemaining -= GOD_RULES.feedAp;
        ctx.apSpent += GOD_RULES.feedAp;
        feed(state, god, ctx);
        god.order = { kind: 'HOLD' };
        god.status = { kind: 'COMPLETE', turn: state.turn + 1 };
      }
    }

    for (let slot = 0; slot < 16; slot += 1) {
      const proposals: Proposal[] = [];
      for (const god of gods) {
        const ctx = contexts.get(god.id) as TurnContext;
        const result = propose(state, god, ctx, impulseAp.get(god.id) ?? 0, crossings.get(god.id) ?? 0);
        if (result === null) continue;
        if ('halt' in result) {
          halt(god, ctx, state.turn + 1, result.halt, result.cells);
          continue;
        }
        proposals.push(result);
      }
      if (proposals.length === 0) break;

      // Simultaneity: intersecting swept regions between moving Gods halt both (Section 2.3).
      const conflicted = new Set<number>();
      const moving = proposals.filter((p) => p.moves);
      for (const a of moving) {
        for (const b of moving) {
          if (a.god.id >= b.god.id) continue;
          if (a.verdict.swept.some((cell) => b.verdict.swept.includes(cell))) {
            conflicted.add(a.god.id);
            conflicted.add(b.god.id);
          }
        }
      }

      for (const proposal of proposals) {
        const { god, verdict } = proposal;
        const ctx = contexts.get(god.id) as TurnContext;
        const order = god.order as MoveOrder;
        if (conflicted.has(god.id)) {
          halt(god, ctx, state.turn + 1, 'GOD_PROXIMITY', verdict.swept);
          continue;
        }
        if (proposal.apToPay > 0) {
          order.stepApPaid += proposal.apToPay;
          impulseAp.set(god.id, (impulseAp.get(god.id) ?? 0) - proposal.apToPay);
          ctx.apRemaining -= proposal.apToPay;
          ctx.apSpent += proposal.apToPay;
          ctx.movementAp += proposal.apToPay;
        }
        if (!proposal.moves) continue;
        god.anchor = verdict.pose.anchor;
        god.heading = verdict.pose.heading;
        order.progress += 1;
        order.stepApPaid = 0;
        ctx.steps += 1;
        if (proposal.forward) {
          crossings.set(god.id, (crossings.get(god.id) ?? 0) + 1);
          ctx.firstForwardDone = true;
          disturb(state, god, verdict.entered);
          for (const cell of verdict.entered) ctx.disturbed.add(cell);
        }
        updateObservation(state, god.ownerId);
        if (order.progress >= order.plan.length) {
          god.status = { kind: 'COMPLETE', turn: state.turn + 1 };
          ctx.completedThisTurn = true;
          continue;
        }
        const obstacle = newlyObservedObstacle(state, god, order);
        if (obstacle) halt(god, ctx, state.turn + 1, 'NEWLY_OBSERVED_OBSTACLE', obstacle);
      }
    }
  }

  // Follow-up actions after a route completes this turn (Section 16.1).
  for (const god of gods) {
    const ctx = contexts.get(god.id) as TurnContext;
    if (god.order.kind !== 'MOVE' || !ctx.completedThisTurn) continue;
    const then = god.order.then;
    if (then === 'FEED' && ctx.apRemaining >= GOD_RULES.feedAp) {
      ctx.apRemaining -= GOD_RULES.feedAp;
      ctx.apSpent += GOD_RULES.feedAp;
      feed(state, god, ctx);
    } else if (then === 'REST') {
      ctx.rested = true;
    }
    god.order = then === 'FEED' && !ctx.fed ? { kind: 'FEED' } : { kind: 'HOLD' };
  }
  for (const god of gods) if (god.order.kind === 'REST') god.order = { kind: 'HOLD' };

  // Step 5 God upkeep, fatigue, recovery and ageing.
  return gods.map((god) => {
    const ctx = contexts.get(god.id) as TurnContext;
    const size = sizeRules(god);
    const required = size.upkeep * 100 + ctx.movementAp * 100;
    const consumed = Math.min(god.reserve, required);
    god.reserve -= consumed;
    const shortfall = required - consumed;
    if (shortfall > 0) {
      god.fatigue += GOD_RULES.shortageFatigue;
      god.vitalHealth = Math.max(0, god.vitalHealth - GOD_RULES.shortageVitalDamagePerMass * size.mass);
    }
    if (god.stance === 'FORCEFUL' && ctx.movementAp > 0) god.fatigue += GOD_RULES.forcefulFatigue;
    if (ctx.rested) {
      god.fatigue -= GOD_RULES.restFatigueRecovery;
      if (shortfall === 0) {
        god.vitalHealth = Math.min(size.health, god.vitalHealth + GOD_RULES.restVitalHeal);
        for (const region of Object.keys(god.regionHealth) as (keyof GodState['regionHealth'])[]) {
          god.regionHealth[region] = Math.min(GOD_RULES.regionHealth, god.regionHealth[region] + GOD_RULES.restRegionHeal);
        }
      }
    }
    god.fatigue = Math.max(0, Math.min(100, god.fatigue));
    god.age += 1;
    // M02 boundary: the permanent-death transaction (remains, memorial, succession) is M05/M07 work;
    // here a God reaching zero vital health only stops accepting living commands.
    if (god.vitalHealth === 0) god.lifecycle = 'DEAD';
    return {
      godId: god.id,
      apSpent: ctx.apSpent,
      movementAp: ctx.movementAp,
      steps: ctx.steps,
      nutritionGained: ctx.nutritionGained,
      nutritionConsumed: consumed,
      shortfall,
      fed: ctx.fed,
      rested: ctx.rested,
      disturbedCells: [...ctx.disturbed].sort((a, b) => a - b),
      halted: ctx.halted,
    };
  });
}

/** Stable fingerprint of a God's orders, for tests and UI change detection. */
export function orderFingerprint(god: GodState): string {
  return canonicalize({ order: god.order, status: god.status });
}
