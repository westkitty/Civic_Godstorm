// Authoritative turn resolution (master Section 2.2), M01 subset. PLANNING drafts are plain command
// lists; resolution is a pure function from (committed state, commands) to the next committed state.
// The input state is never mutated.

import { runSettlementTurn } from '../civ/economy.ts';
import { resolveGods } from '../gods/resolve.ts';
import { resolveCorpses } from '../gods/corpse.ts';
import { updateAllObservations } from '../observation/observation.ts';
import { JOBS, PHYSICAL_RESOURCES } from '../data/rules.ts';
import { canonicalHash } from './canonical.ts';
import { applyCommand, compareCommands, laborMilli, validateCommand, type Command, type Rejection } from './commands.ts';
import type { CampaignState } from './state.ts';
import { TECH_BY_ID, type PolicyAxis } from '../data/tech.ts';
import { regenerateEcologyWithSoil } from '../world/ecology.ts';
import { resolveArmiesTurn } from '../military/army.ts';

export interface TurnResult {
  readonly state: CampaignState;
  readonly accepted: readonly string[];
  readonly rejections: readonly Rejection[];
  readonly stateHash: string;
}

export class InvariantViolation extends Error {
  override readonly name = 'InvariantViolation';
}

export function hashState(state: CampaignState): string {
  return canonicalHash(state);
}

/** Step 3: ecological replenishment and multi-turn soil recovery (master Sections 3.2, 4.6). */
export function regenerateEcology(state: CampaignState): void {
  regenerateEcologyWithSoil(state);
}

/** Checks every bounded quantity; thrown violations are defects, never clamped away. */
export function assertInvariants(state: CampaignState): void {
  const problems: string[] = [];
  for (const civ of state.civs) {
    if (!Number.isSafeInteger(civ.coin) || civ.coin < 0) problems.push(`civ ${civ.id} coin ${civ.coin}`);
    if (!Number.isSafeInteger(civ.knowledge) || civ.knowledge < 0) problems.push(`civ ${civ.id} knowledge ${civ.knowledge}`);
  }
  for (const settlement of state.settlements) {
    if (!Number.isSafeInteger(settlement.populationMilli) || settlement.populationMilli < 0) {
      problems.push(`settlement ${settlement.id} population ${settlement.populationMilli}`);
    }
    for (const resource of PHYSICAL_RESOURCES) {
      const value = settlement.storage[resource];
      if (!Number.isSafeInteger(value) || value < 0) problems.push(`settlement ${settlement.id} ${resource} ${value}`);
    }
    const assigned = JOBS.reduce((sum, job) => sum + settlement.jobs[job], 0);
    if (assigned > laborMilli(settlement)) problems.push(`settlement ${settlement.id} jobs ${assigned} > labour`);
    for (const item of settlement.queue) {
      if (item.workDone < 0 || item.workDone > item.workRequired) problems.push(`queue item ${item.id} work ${item.workDone}`);
    }
  }
  for (const god of state.gods) {
    if (god.reserve < 0 || !Number.isSafeInteger(god.reserve)) problems.push(`god ${god.id} reserve ${god.reserve}`);
    if (god.fatigue < 0 || god.fatigue > 100) problems.push(`god ${god.id} fatigue ${god.fatigue}`);
    if (god.vitalHealth < 0) problems.push(`god ${god.id} vital ${god.vitalHealth}`);
  }
  for (const army of state.armies) {
    if (!Number.isSafeInteger(army.id) || army.id <= 0) problems.push(`army id ${army.id}`);
    if (!state.civs.some((c) => c.id === army.ownerId)) problems.push(`army ${army.id} owner ${army.ownerId}`);
    if (army.cell < 0 || army.cell >= state.map.elevation.length) problems.push(`army ${army.id} cell ${army.cell}`);
    if (army.companies.length > 6) problems.push(`army ${army.id} companies ${army.companies.length} > 6`);
    for (const company of army.companies) {
      if (company.cohesion < 0 || company.cohesion > 100) problems.push(`army ${army.id} company cohesion ${company.cohesion}`);
      if (company.equipment < 0 || company.equipment > 1000) problems.push(`army ${army.id} company equipment ${company.equipment}`);
      if (company.populationMilli < 0) problems.push(`army ${army.id} company pop ${company.populationMilli}`);
    }
  }
  const { map } = state;
  for (let cell = 0; cell < map.biomass.length; cell += 1) {
    const biomass = map.biomass[cell] as number;
    if (biomass < 0 || biomass > (map.biomassCapacity[cell] as number)) problems.push(`cell ${cell} biomass ${biomass}`);
    if ((map.stoneReserve[cell] as number) < 0) problems.push(`cell ${cell} stone`);
    const disturbance = map.soilDisturbance[cell] as number;
    if (disturbance < 0 || disturbance > 1000) problems.push(`cell ${cell} disturbance ${disturbance}`);
  }
  if (problems.length > 0) throw new InvariantViolation(problems.slice(0, 10).join('; '));
}

export function resolveTurn(committed: CampaignState, commands: readonly Command[]): TurnResult {
  const state = structuredClone(committed);
  const accepted: string[] = [];
  const rejections: Rejection[] = [];
  const seen = new Set<string>();

  // Steps 1-2: validate in stable order and apply accepted orders/reservations sequentially.
  for (const command of [...commands].sort(compareCommands)) {
    if (seen.has(command.commandId)) {
      rejections.push({ commandId: command.commandId, code: 'UNSUPPORTED_STATE', reason: 'duplicate command ID' });
      continue;
    }
    seen.add(command.commandId);
    const verdict = validateCommand(state, command);
    if (!verdict.ok) {
      rejections.push({ commandId: command.commandId, code: verdict.code, reason: verdict.reason });
      continue;
    }
    applyCommand(state, command);
    accepted.push(command.commandId);
  }

  // Step 3: ecology.
  regenerateEcology(state);

  // Step 4 and God upkeep of step 5: four impulses of God movement/actions, then needs.
  const gods = resolveGods(state);
  resolveCorpses(state);

  // Step 5: production, consumption, population and construction, in settlement ID order.
  const summaries = [...state.settlements]
    .sort((a, b) => a.id - b.id)
    .map((settlement) => runSettlementTurn(state, settlement));

  // Step 5b: civilization research progression and policy cooldowns.
  for (const civ of state.civs) {
    if (civ.policyCooldowns) {
      for (const axis of Object.keys(civ.policyCooldowns) as PolicyAxis[]) {
        if (civ.policyCooldowns[axis] > 0) {
          civ.policyCooldowns[axis] -= 1;
        }
      }
    }
    if (civ.currentResearch) {
      const tech = TECH_BY_ID.get(civ.currentResearch.techId);
      if (tech) {
        const needed = tech.cost - civ.currentResearch.progress;
        const invested = Math.min(needed, civ.knowledge);
        civ.knowledge -= invested;
        civ.currentResearch.progress += invested;
        if (civ.currentResearch.progress >= tech.cost) {
          civ.completedTechs.push(tech.id);
          state.history.push({
            eventId: state.history.length + 1,
            turn: state.turn,
            impulse: 0,
            type: 'TECH_RESEARCHED',
            actorIds: [civ.id],
            locationIds: [],
            causeIds: [],
            observerCivIds: [civ.id],
            payload: {
              civId: civ.id,
              techId: tech.id,
              name: tech.name,
            },
            schemaVersion: 1,
          });
          civ.currentResearch = null;
        }
      }
    }
  }

  // Step 5c: strategic armies logistics, supplies and maintenance.
  resolveArmiesTurn(state);

  // Step 6: observations, then commit.
  updateAllObservations(state);
  state.turn += 1;
  state.lastTurn = { turn: state.turn, settlements: summaries, gods };
  assertInvariants(state);
  return { state, accepted, rejections, stateHash: hashState(state) };
}
