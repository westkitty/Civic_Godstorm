// Causal world history event ledger, DAG tracing and deterministic prose generation
// (master Sections 13.1, 16.5). Immutable semantic events with monotonic IDs and causal edges.

import type { CampaignState, HistoryEvent, HistoryEventType } from './state.ts';

export interface NewHistoryEvent {
  readonly turn: number;
  readonly impulse?: number | undefined;
  readonly type: HistoryEventType;
  readonly actorIds: readonly number[];
  readonly locationIds: readonly number[];
  readonly causeIds?: readonly number[] | undefined;
  readonly observerCivIds: readonly number[];
  readonly payload: Record<string, string | number>;
}

export interface HistoryQueryFilter {
  readonly types?: readonly HistoryEventType[] | undefined;
  readonly actorId?: number | undefined;
  readonly locationId?: number | undefined;
  readonly causeId?: number | undefined;
  readonly minTurn?: number | undefined;
  readonly maxTurn?: number | undefined;
  /** When specified, returns only events observable by this civilization. */
  readonly observerCivId?: number | undefined;
}

export interface ChronicleEntry {
  readonly eventId: number;
  readonly turn: number;
  readonly impulse: number;
  readonly type: HistoryEventType;
  readonly text: string;
  readonly causes: readonly number[];
  readonly consequences: readonly number[];
}

/**
 * Monotonically allocates an event ID from campaign state and appends the immutable event.
 * Enforces causal DAG discipline: causeIds must reference strictly earlier event IDs.
 */
export function recordHistoryEvent(state: CampaignState, event: NewHistoryEvent): HistoryEvent {
  const eventId = state.nextEventId > 0 ? state.nextEventId : state.history.length + 1;
  state.nextEventId = eventId + 1;

  // Validate that all causeIds are prior events
  const causeIds = (event.causeIds ?? []).filter((id) => id > 0 && id < eventId);

  const created: HistoryEvent = {
    eventId,
    turn: event.turn,
    impulse: event.impulse ?? 0,
    type: event.type,
    actorIds: [...event.actorIds],
    locationIds: [...event.locationIds],
    causeIds,
    observerCivIds: [...event.observerCivIds],
    payload: { ...event.payload },
    schemaVersion: 1,
  };

  state.history.push(created);
  return created;
}

/** Finds the direct ancestor events cited by eventId. */
export function getDirectCauses(state: CampaignState, eventId: number): HistoryEvent[] {
  const target = state.history.find((e) => e.eventId === eventId);
  if (!target || target.causeIds.length === 0) return [];
  const causeSet = new Set(target.causeIds);
  return state.history.filter((e) => causeSet.has(e.eventId));
}

/** Traverses upstream causal DAG to return all ancestral causes in chronological order. */
export function getAncestralCausalChain(state: CampaignState, eventId: number): HistoryEvent[] {
  const eventMap = new Map<number, HistoryEvent>();
  for (const event of state.history) {
    eventMap.set(event.eventId, event);
  }

  const visited = new Set<number>();
  const ancestors: HistoryEvent[] = [];

  function visit(id: number): void {
    if (visited.has(id)) return;
    visited.add(id);
    const event = eventMap.get(id);
    if (!event) return;
    for (const parentId of event.causeIds) {
      visit(parentId);
    }
    if (id !== eventId) {
      ancestors.push(event);
    }
  }

  visit(eventId);
  return ancestors.sort((a, b) => a.eventId - b.eventId);
}

/** Finds all events directly citing eventId as a cause. */
export function getDirectConsequences(state: CampaignState, eventId: number): HistoryEvent[] {
  return state.history.filter((e) => e.causeIds.includes(eventId));
}

/** Finds all direct and transitive downstream consequence events. */
export function getAllConsequences(state: CampaignState, eventId: number): HistoryEvent[] {
  const descendants: HistoryEvent[] = [];
  const queue = [eventId];
  const visited = new Set<number>([eventId]);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const event of state.history) {
      if (event.causeIds.includes(currentId) && !visited.has(event.eventId)) {
        visited.add(event.eventId);
        descendants.push(event);
        queue.push(event.eventId);
      }
    }
  }

  return descendants.sort((a, b) => a.eventId - b.eventId);
}

/**
 * Section 13.1: Formats an event into deterministic authored historical prose without AI.
 * Employs campaign context (civ names, settlement names, god references) to render readable text.
 */
export function formatHistoryProse(event: HistoryEvent, state: CampaignState): string {
  const civ = event.actorIds[0] !== undefined ? state.civs.find((c) => c.id === event.actorIds[0]) : undefined;
  const civName = civ?.name ?? `Civilization ${event.actorIds[0] ?? 'Unknown'}`;
  const cell = event.locationIds[0] !== undefined ? `cell ${event.locationIds[0]}` : 'an unknown location';
  const p = event.payload;

  switch (event.type) {
    case 'CITY_FOUNDED': {
      const name = p.name ? String(p.name) : `Settlement ${event.actorIds[1] ?? ''}`;
      return `Turn ${event.turn}: ${civName} founded the settlement of ${name} upon ${cell}.`;
    }
    case 'CITY_DESTROYED': {
      const name = p.name ? String(p.name) : `Settlement ${event.actorIds[0] ?? ''}`;
      return `Turn ${event.turn}: The settlement of ${name} was destroyed at ${cell}.`;
    }
    case 'CITY_PACKED':
      return `Turn ${event.turn}: ${civName} packed settlement ${p.settlementId ?? ''} into a mobile convoy.`;
    case 'CITY_UNPACKED':
      return `Turn ${event.turn}: ${civName} unpacked caravan settlement ${p.settlementId ?? ''} at ${cell}.`;
    case 'ROUTE_CHANGED': {
      const reason = p.reason ? String(p.reason) : 'colossal impact';
      return `Turn ${event.turn}: Road infrastructure at ${cell} was disrupted by ${reason}.`;
    }
    case 'TERRITORY_CHANGED':
      return `Turn ${event.turn}: Territorial control over ${cell} shifted to ${civName}.`;
    case 'TRADE_INCIDENT':
      return `Turn ${event.turn}: A trade incident occurred at ${cell} involving ${civName}.`;
    case 'TREATY_SIGNED':
      return `Turn ${event.turn}: A diplomatic treaty was signed between signatory factions.`;
    case 'TREATY_BREACHED':
      return `Turn ${event.turn}: A formal treaty breach occurred at ${cell}.`;
    case 'WAR_STARTED':
      return `Turn ${event.turn}: War commenced between belligerent powers.`;
    case 'WAR_ENDED':
      return `Turn ${event.turn}: Hostilities ceased and formal peace was concluded.`;
    case 'GOD_MIGRATED':
      return `Turn ${event.turn}: God ${p.godId ?? event.actorIds[0]} completed a long-range migration to ${cell}.`;
    case 'GOD_INJURED':
    case 'GOD_WOUNDED': {
      const godId = p.godId ?? event.actorIds[0];
      const severity = p.severity ?? 1;
      const type = p.woundType ?? p.type ?? 'injury';
      const region = p.region ?? 'anatomy';
      return `Turn ${event.turn}: God ${godId} suffered a severity ${severity} ${type} wound to its ${region}.`;
    }
    case 'GOD_RECOVERED':
    case 'GOD_HEALED': {
      const godId = p.godId ?? event.actorIds[0];
      const region = p.region ?? 'body';
      const scar = p.scar ? ' (scarred)' : '';
      return `Turn ${event.turn}: God ${godId} recovered from wounds to its ${region}${scar}.`;
    }
    case 'GOD_EVOLVED':
      return `Turn ${event.turn}: God ${p.godId ?? event.actorIds[0]} completed morphological adaptation ${p.adaptation ?? ''}.`;
    case 'GOD_ENCOUNTER':
      return `Turn ${event.turn}: Colossal entities encountered one another at ${cell}.`;
    case 'GOD_DIED': {
      const godId = p.godId ?? event.actorIds[0];
      return `Turn ${event.turn}: Colossal God ${godId} perished at ${cell}, leaving its physical remains upon the land.`;
    }
    case 'REMAINS_TRANSFORMED':
    case 'CORPSE_STAGE_CHANGED': {
      const godId = p.godId ?? event.actorIds[0];
      const stage = p.stage ?? 'DECAY';
      return `Turn ${event.turn}: The anatomical remains of God ${godId} transitioned into the ${stage} stage.`;
    }
    case 'REMAINS_EXTRACTED':
    case 'CORPSE_HARVESTED': {
      const godId = p.godId ?? event.actorIds[1];
      const res = p.resource ?? 'BIO';
      const units = p.units ?? 0;
      return `Turn ${event.turn}: Settlement ${p.settlementId ?? ''} harvested ${units} units of ${res} from the remains of God ${godId}.`;
    }
    case 'POPULATION_DISPLACED':
      return `Turn ${event.turn}: Populations were displaced from ${cell}.`;
    case 'INSTITUTION_SHIFTED':
      return `Turn ${event.turn}: Political and institutional authority shifted within ${civName}.`;
    case 'DISASTER':
      return `Turn ${event.turn}: An environmental catastrophe struck ${cell}.`;
    case 'MEGAPROJECT_FINISHED':
      return `Turn ${event.turn}: ${civName} completed construction of the megaproject ${p.project ?? ''}.`;
    case 'ENDING_REACHED':
      return `Turn ${event.turn}: The historical chronicle concluded: ${p.ending ?? 'Victory'}.`;
    case 'TECH_RESEARCHED':
      return `Turn ${event.turn}: Scholars of ${civName} unlocked technology ${p.name ?? p.techId}.`;
    case 'POLICY_ADOPTED':
      return `Turn ${event.turn}: The council of ${civName} enacted policy ${p.policyId ?? ''} under ${p.axis ?? ''}.`;
    case 'GOD_STRIKE':
      return `Turn ${event.turn}: God ${p.godId ?? event.actorIds[0]} struck ${cell}, causing severe shock and soil disturbance.`;
    case 'GOD_ASSIST':
      return `Turn ${event.turn}: God ${p.godId ?? event.actorIds[0]} aided settlement ${p.settlementId ?? ''} with divine ${p.service ?? 'assistance'}.`;
    case 'GOD_CULTIVATE':
      return `Turn ${event.turn}: God ${p.godId ?? event.actorIds[0]} cultivated ${cell}, restoring vegetative fertility.`;
    case 'GOD_GUARD':
      return `Turn ${event.turn}: God ${p.godId ?? event.actorIds[0]} established a defensive guard perimeter.`;
    case 'GOD_AGED':
      return `Turn ${event.turn}: God ${p.godId ?? event.actorIds[0]} entered the ${p.bracket ?? ''} age bracket at age ${p.age ?? ''}.`;
    default:
      return `Turn ${event.turn}: Historical event occurred at ${cell}.`;
  }
}

/** Queries historical events matching specified filters and observer visibility. */
export function queryHistory(state: CampaignState, filter: HistoryQueryFilter = {}): HistoryEvent[] {
  return state.history.filter((event) => {
    if (filter.observerCivId !== undefined) {
      if (event.observerCivIds.length > 0 && !event.observerCivIds.includes(filter.observerCivId)) {
        return false;
      }
    }
    if (filter.types && !filter.types.includes(event.type)) {
      return false;
    }
    if (filter.actorId !== undefined && !event.actorIds.includes(filter.actorId)) {
      return false;
    }
    if (filter.locationId !== undefined && !event.locationIds.includes(filter.locationId)) {
      return false;
    }
    if (filter.causeId !== undefined && !event.causeIds.includes(filter.causeId)) {
      return false;
    }
    if (filter.minTurn !== undefined && event.turn < filter.minTurn) {
      return false;
    }
    if (filter.maxTurn !== undefined && event.turn > filter.maxTurn) {
      return false;
    }
    return true;
  });
}

/**
 * Builds an ordered chronicle for display, annotated with causal linkages and formatted prose.
 */
export function buildChronicle(state: CampaignState, observerCivId?: number): ChronicleEntry[] {
  const events = queryHistory(state, { observerCivId });
  const allEvents = state.history;

  return events.map((event) => {
    const consequences = allEvents
      .filter((e) => e.causeIds.includes(event.eventId))
      .map((e) => e.eventId);

    return {
      eventId: event.eventId,
      turn: event.turn,
      impulse: event.impulse,
      type: event.type,
      text: formatHistoryProse(event, state),
      causes: [...event.causeIds],
      consequences,
    };
  });
}
