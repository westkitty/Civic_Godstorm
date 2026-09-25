// God command validation (master Sections 4.4, 4.5, 16.1). Validation reads only the issuing
// civilization's observation, so a rejection can never reveal hidden truth. Physics is enforced
// later, during resolution, against true state.

import type { Command, ConsentScope, ValidationResult } from '../core/commands.ts';
import type { CampaignState } from '../core/state.ts';
import { GOD_RULES } from '../data/rules.ts';
import { buildObservationView, observedKnowledge } from '../observation/observation.ts';
import { apForFatigue, type GodState, type Stance } from './god.ts';
import { planRoute, type RoutePlan } from './planner.ts';

export type GodCommand = Extract<Command, { kind: `GOD_${string}` }>;

const STANCES: readonly Stance[] = ['CAREFUL', 'NORMAL', 'FORCEFUL'];
const fail = (code: Extract<ValidationResult, { ok: false }>['code'], reason: string): ValidationResult => ({ ok: false, code, reason });

export function isGodCommand(command: Command): command is GodCommand {
  return command.kind.startsWith('GOD_');
}

function covers(scope: readonly number[] | undefined, cells: readonly number[]): boolean {
  return cells.every((cell) => scope?.includes(cell) ?? false);
}

export function consentCovers(consent: ConsentScope, plan: Pick<RoutePlan, 'civilianCollateral' | 'trespass'>): boolean {
  return covers(consent.civilianCollateral, plan.civilianCollateral) && covers(consent.trespass, plan.trespass);
}

/** Plans the ordered route exactly as the issuing player previewed it (same observation, same planner). */
export function planForCommand(state: CampaignState, god: GodState, command: Extract<GodCommand, { kind: 'GOD_MOVE' }>) {
  const view = buildObservationView(state, god.ownerId);
  const knowledge = observedKnowledge(view, god.id);
  return planRoute(knowledge, god.ownerId, god.maskName, { anchor: god.anchor, heading: god.heading }, command.options.waypoints, command.options.routeMode);
}

export function validateGodCommand(state: CampaignState, command: GodCommand): ValidationResult {
  const god = state.gods.find((g) => g.id === command.actorId);
  if (!god || god.ownerId !== command.civId) return fail('NOT_OWNER', 'actor is not a God owned by this civilization');
  if (god.lifecycle !== 'ALIVE') return fail('UNSUPPORTED_STATE', 'this God has died; living commands are unavailable');
  switch (command.kind) {
    case 'GOD_MOVE': {
      const { waypoints, routeMode, then } = command.options;
      const cells = state.map.width * state.map.height;
      if (!Array.isArray(waypoints) || waypoints.length === 0 || waypoints.length > GOD_RULES.maxWaypoints) {
        return fail('UNSUPPORTED_STATE', `a route needs 1-${GOD_RULES.maxWaypoints} waypoints`);
      }
      if (waypoints.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= cells)) return fail('UNSUPPORTED_STATE', 'waypoint outside the map');
      if (routeMode !== 'SAFE' && routeMode !== 'DIRECT') return fail('UNSUPPORTED_STATE', 'unknown route mode');
      if (then !== null && then !== 'FEED' && then !== 'REST') return fail('UNSUPPORTED_STATE', 'unknown follow-up action');
      if (apForFatigue(god.fatigue) === 0) return fail('INSUFFICIENT_AP', 'exhausted (fatigue 100): only REST, FEED or HOLD are legal');
      const plan = planForCommand(state, god, command);
      if (!plan.ok) {
        if (plan.failure === 'BUDGET_EXCEEDED') return fail('BUDGET_EXCEEDED', `route search budget exhausted at waypoint ${plan.waypointIndex + 1}; choose a closer waypoint`);
        return fail('BODY_BLOCKED', `no legal body route to waypoint ${plan.waypointIndex + 1} (${plan.failure})`);
      }
      if (!consentCovers(command.consent, plan)) {
        return fail('CONSENT_REQUIRED', `route crosses ${plan.civilianCollateral.length} farm and ${plan.trespass.length} claimed cells without explicit consent`);
      }
      return { ok: true };
    }
    case 'GOD_FEED':
    case 'GOD_REST':
    case 'GOD_HOLD':
      return { ok: true };
    case 'GOD_STANCE':
      return STANCES.includes(command.options.stance) ? { ok: true } : fail('UNSUPPORTED_STATE', 'unknown stance');
  }
}

export function applyGodCommand(state: CampaignState, command: GodCommand): void {
  const god = state.gods.find((g) => g.id === command.actorId) as GodState;
  switch (command.kind) {
    case 'GOD_MOVE': {
      const plan = planForCommand(state, god, command);
      if (!plan.ok) throw new Error('validated route no longer plans');
      god.order = {
        kind: 'MOVE',
        commandId: command.commandId,
        waypoints: [...command.options.waypoints],
        routeMode: command.options.routeMode,
        then: command.options.then,
        consent: structuredClone(command.consent),
        plan: plan.steps,
        progress: 0,
        stepApPaid: 0,
      };
      god.status = { kind: 'ACTIVE' };
      return;
    }
    case 'GOD_FEED':
      god.order = { kind: 'FEED' };
      god.status = { kind: 'ACTIVE' };
      return;
    case 'GOD_REST':
      god.order = { kind: 'REST' };
      god.status = { kind: 'ACTIVE' };
      return;
    case 'GOD_HOLD':
      god.order = { kind: 'HOLD' };
      god.status = { kind: 'IDLE' };
      return;
    case 'GOD_STANCE':
      god.stance = command.options.stance;
      return;
  }
}
