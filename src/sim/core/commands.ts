// Command schema and validation (master Section 16.1). Human UI drafts and AI drafts use exactly
// this validator. Every rejection carries a stable code; nothing is silently remapped.

import { BUILD_RULES, ECONOMY_RULES, JOBS, WORLD_RULES, type BuildKind, type PhysicalResource } from '../data/rules.ts';
import { cellsWithin, neighbors } from '../world/hex.ts';
import { isWater, isWoodland } from '../world/generate.ts';
import { units } from './quantity.ts';
import type { CampaignState, JobAllocation, SettlementState } from './state.ts';

export const REJECTION_CODES = [
  'NOT_OWNER',
  'STALE_STATE',
  'UNOBSERVED_TARGET',
  'WRONG_DOMAIN',
  'INSUFFICIENT_AP',
  'INSUFFICIENT_STOCK',
  'BODY_BLOCKED',
  'RIGHTS_REQUIRED',
  'CONSENT_REQUIRED',
  'PREREQUISITE_MISSING',
  'CAPACITY_REACHED',
  'UNSUPPORTED_STATE',
  'BUDGET_EXCEEDED',
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export type ConsentKind = 'trespass' | 'civilianCollateral' | 'protectedExtraction' | 'godEscalation';
/** Consent is scoped to explicit targets (cells or actor IDs), never a universal flag. */
export type ConsentScope = Readonly<Partial<Record<ConsentKind, readonly number[]>>>;

interface CommandBase {
  readonly commandId: string;
  readonly civId: number;
  readonly actorId: number;
  readonly issuedForTurn: number;
  readonly sequence: number;
  readonly target: number | null;
  readonly consent: ConsentScope;
  readonly expectedStateVersion: number;
}

export type Command =
  | (CommandBase & { readonly kind: 'SET_JOBS'; readonly options: JobAllocation })
  | (CommandBase & { readonly kind: 'QUEUE_BUILD'; readonly options: { readonly build: BuildKind } })
  | (CommandBase & { readonly kind: 'CANCEL_BUILD'; readonly options: { readonly itemId: number } });

export interface Rejection {
  readonly commandId: string;
  readonly code: RejectionCode;
  readonly reason: string;
}

export type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly code: RejectionCode; readonly reason: string };

const OK: ValidationResult = { ok: true };
const fail = (code: RejectionCode, reason: string): ValidationResult => ({ ok: false, code, reason });

/** Stable validation order (Section 2.2): civ, actor, sequence, then command ID. */
export function compareCommands(a: Command, b: Command): number {
  return a.civId - b.civId || a.actorId - b.actorId || a.sequence - b.sequence || (a.commandId < b.commandId ? -1 : a.commandId > b.commandId ? 1 : 0);
}

export function laborMilli(settlement: SettlementState): number {
  return Math.floor((settlement.populationMilli * ECONOMY_RULES.laborPerMille) / 1000);
}

/** Worked radius for forestry and quarry sites (M01 default: two rings). */
export const WORK_RADIUS = 2;

export function forestrySite(state: CampaignState, settlement: SettlementState): number | null {
  const candidates = cellsWithin(state.map, settlement.cell, WORK_RADIUS)
    .filter((cell) => cell !== settlement.cell && isWoodland(state.map, cell))
    .sort((a, b) => (state.map.biomass[b] as number) - (state.map.biomass[a] as number) || a - b);
  return candidates[0] ?? null;
}

export function quarrySite(state: CampaignState, settlement: SettlementState): number | null {
  const candidates = cellsWithin(state.map, settlement.cell, WORK_RADIUS)
    .filter((cell) => (state.map.stoneReserve[cell] as number) > 0)
    .sort((a, b) => (state.map.stoneReserve[b] as number) - (state.map.stoneReserve[a] as number) || a - b);
  return candidates[0] ?? null;
}

export function housingCapacityMilli(settlement: SettlementState): number {
  const units = Math.min(ECONOMY_RULES.maxHousing, ECONOMY_RULES.coreHousing + ECONOMY_RULES.dwellingHousing * settlement.dwellings);
  return units * 1000;
}

function validateJobs(state: CampaignState, settlement: SettlementState, jobs: JobAllocation): ValidationResult {
  const perSite = ECONOMY_RULES.maxWorkersPerSite * 1000;
  let total = 0;
  for (const job of JOBS) {
    const value = jobs[job];
    if (!Number.isSafeInteger(value) || value < 0) return fail('UNSUPPORTED_STATE', `${job} allocation must be a non-negative integer`);
    total += value;
  }
  if (Object.keys(jobs).length !== JOBS.length) return fail('UNSUPPORTED_STATE', 'unknown job key');
  if (total > laborMilli(settlement)) return fail('CAPACITY_REACHED', `assigned ${total} milli-workers exceeds labour ${laborMilli(settlement)}`);
  if (jobs.farm > settlement.farmSites.length * perSite) return fail('CAPACITY_REACHED', 'farm workers exceed four per farm site');
  if (jobs.forestry > perSite) return fail('CAPACITY_REACHED', 'forestry site holds at most four workers');
  if (jobs.quarry > perSite) return fail('CAPACITY_REACHED', 'quarry site holds at most four workers');
  if (jobs.forestry > 0 && forestrySite(state, settlement) === null) return fail('PREREQUISITE_MISSING', 'no woodland within the worked radius');
  if (jobs.quarry > 0 && quarrySite(state, settlement) === null) return fail('PREREQUISITE_MISSING', 'no quarryable stone within the worked radius');
  return OK;
}

function validateBuild(state: CampaignState, settlement: SettlementState, build: BuildKind, cell: number | null): ValidationResult {
  if (settlement.queue.length >= ECONOMY_RULES.maxQueueLength) return fail('CAPACITY_REACHED', 'build queue is full');
  if (build === 'DWELLING') {
    if (cell !== settlement.cell) return fail('UNSUPPORTED_STATE', 'DWELLING targets its own settlement cell');
    const planned = settlement.dwellings + settlement.queue.filter((item) => item.kind === 'DWELLING').length;
    if (planned >= ECONOMY_RULES.maxDistrictParcels) return fail('CAPACITY_REACHED', 'all six district parcels are used');
  } else {
    if (cell === null || !neighbors(state.map, settlement.cell).includes(cell)) return fail('UNSUPPORTED_STATE', 'FARM must target an adjacent cell');
    if (isWater(state.map, cell)) return fail('WRONG_DOMAIN', 'FARM cannot be built on water');
    if ((state.map.fertility[cell] as number) < WORLD_RULES.minFarmFertility) return fail('PREREQUISITE_MISSING', 'fertility below 250');
    const taken = state.settlements.some((other) => other.cell === cell || other.farmSites.some((site) => site.cell === cell)
      || other.queue.some((item) => item.kind === 'FARM' && item.cell === cell));
    if (taken) return fail('CAPACITY_REACHED', 'cell already holds a settlement or farm');
  }
  for (const [resource, amount] of Object.entries(BUILD_RULES[build].materials)) {
    const key = resource as PhysicalResource;
    if (settlement.storage[key] < units(amount)) return fail('INSUFFICIENT_STOCK', `${build} needs ${amount} ${key}`);
  }
  return OK;
}

export function validateCommand(state: CampaignState, command: Command): ValidationResult {
  if (command.expectedStateVersion !== state.turn || command.issuedForTurn !== state.turn + 1) {
    return fail('STALE_STATE', `command names state ${command.expectedStateVersion}/turn ${command.issuedForTurn}; current state ${state.turn}`);
  }
  if (!state.civs.some((civ) => civ.id === command.civId)) return fail('NOT_OWNER', 'unknown civilization');
  const settlement = state.settlements.find((s) => s.id === command.actorId);
  if (!settlement || settlement.ownerId !== command.civId) return fail('NOT_OWNER', 'actor is not owned by this civilization');
  switch (command.kind) {
    case 'SET_JOBS':
      return validateJobs(state, settlement, command.options);
    case 'QUEUE_BUILD':
      return validateBuild(state, settlement, command.options.build, command.target);
    case 'CANCEL_BUILD':
      return settlement.queue.some((item) => item.id === command.options.itemId)
        ? OK
        : fail('UNSUPPORTED_STATE', 'no such queued item');
  }
}

/** Applies an already validated command to mutable (cloned) state. */
export function applyCommand(state: CampaignState, command: Command): void {
  const settlement = state.settlements.find((s) => s.id === command.actorId) as SettlementState;
  switch (command.kind) {
    case 'SET_JOBS':
      settlement.jobs = { ...command.options };
      return;
    case 'QUEUE_BUILD': {
      const rule = BUILD_RULES[command.options.build];
      for (const [resource, amount] of Object.entries(rule.materials)) {
        const key = resource as PhysicalResource;
        settlement.storage[key] -= units(amount);
      }
      settlement.queue.push({
        id: state.nextEntityId,
        kind: command.options.build,
        cell: command.target as number,
        reservedBy: command.commandId,
        workRequired: units(rule.work),
        workDone: 0,
      });
      state.nextEntityId += 1;
      return;
    }
    case 'CANCEL_BUILD': {
      const index = settlement.queue.findIndex((item) => item.id === command.options.itemId);
      const [item] = settlement.queue.splice(index, 1);
      // Releasing an untouched reservation refunds it; once work has begun, materials are consumed.
      if (item && item.workDone === 0) {
        for (const [resource, amount] of Object.entries(BUILD_RULES[item.kind].materials)) {
          const key = resource as PhysicalResource;
          settlement.storage[key] += units(amount);
        }
      }
      return;
    }
  }
}
