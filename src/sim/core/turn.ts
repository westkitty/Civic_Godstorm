// Authoritative turn resolution (master Section 2.2), M01 subset. PLANNING drafts are plain command
// lists; resolution is a pure function from (committed state, commands) to the next committed state.
// The input state is never mutated.

import { runSettlementTurn } from '../civ/economy.ts';
import { resolveGods } from '../gods/resolve.ts';
import { updateAllObservations } from '../observation/observation.ts';
import { BIOME_RULES, BIOMES, JOBS, PHYSICAL_RESOURCES, type Biome } from '../data/rules.ts';
import { canonicalHash } from './canonical.ts';
import { applyCommand, compareCommands, laborMilli, validateCommand, type Command, type Rejection } from './commands.ts';
import type { CampaignState } from './state.ts';

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

/** Step 3: ecological replenishment, floor((capacity - current) * rate / 1000), minimum 1 below capacity. */
export function regenerateEcology(state: CampaignState): void {
  const { map } = state;
  for (let cell = 0; cell < map.biomass.length; cell += 1) {
    const capacity = map.biomassCapacity[cell] as number;
    const current = map.biomass[cell] as number;
    if (current >= capacity) continue;
    const rate = BIOME_RULES[BIOMES[map.biome[cell] as number] as Biome].regenRate;
    if (rate === 0) continue;
    map.biomass[cell] = Math.min(capacity, current + Math.max(1, Math.floor(((capacity - current) * rate) / 1000)));
  }
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
  const { map } = state;
  for (let cell = 0; cell < map.biomass.length; cell += 1) {
    const biomass = map.biomass[cell] as number;
    if (biomass < 0 || biomass > (map.biomassCapacity[cell] as number)) problems.push(`cell ${cell} biomass ${biomass}`);
    if ((map.stoneReserve[cell] as number) < 0) problems.push(`cell ${cell} stone`);
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

  // Step 5: production, consumption, population and construction, in settlement ID order.
  const summaries = [...state.settlements]
    .sort((a, b) => a.id - b.id)
    .map((settlement) => runSettlementTurn(state, settlement));

  // Step 6: observations, then commit.
  updateAllObservations(state);
  state.turn += 1;
  state.lastTurn = { turn: state.turn, settlements: summaries, gods };
  assertInvariants(state);
  return { state, accepted, rejections, stateHash: hashState(state) };
}
