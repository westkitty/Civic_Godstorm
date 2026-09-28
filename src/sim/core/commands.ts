// Command schema and validation (master Section 16.1). Human UI drafts and AI drafts use exactly
// this validator. Every rejection carries a stable code; nothing is silently remapped.

import { BUILD_RULES, ECONOMY_RULES, JOBS, WORLD_RULES, type BuildKind, type PhysicalResource } from '../data/rules.ts';
import { cellsWithin, distance, neighbors } from '../world/hex.ts';
import { isWater, isWoodland } from '../world/generate.ts';
import { units } from './quantity.ts';
import type { CampaignState, JobAllocation, SettlementState } from './state.ts';
import type { FollowUp, RouteMode, Stance } from '../gods/god.ts';
import { applyGodCommand, isGodCommand, validateGodCommand } from '../gods/commands.ts';
import { registerFoundingLandmark } from '../world/landmarks.ts';
import {
  canResearchTech,
  POLICY_AXES,
  POLICY_CHOICES,
  POLICY_COOLDOWN_TURNS,
  POLICY_COST_COIN,
  TECH_BY_ID,
  type PolicyAxis,
  type PolicyChoice,
} from '../data/tech.ts';
import {
  ARMY_RULES,
  ARMY_STANCES,
  COMPANY_SPECS,
  COMPANY_TYPES,
  disbandArmy,
  resolveArmyClash,
  type ArmyStance,
  type CompanyState,
  type CompanyType,
} from '../military/army.ts';
import { findPath, terrainStepCost } from '../world/path.ts';
import {
  adjustTrust,
  CLAUSE_IDS,
  getDiplomaticRelation,
  validateCellPassage,
  type Treaty,
  type TreatyClause,
} from '../diplomacy/treaty.ts';

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
  | (CommandBase & { readonly kind: 'CANCEL_BUILD'; readonly options: { readonly itemId: number } })
  | (CommandBase & { readonly kind: 'FOUND_SETTLEMENT'; readonly options: { readonly name?: string } })
  | (CommandBase & { readonly kind: 'RESEARCH_TECH'; readonly options: { readonly techId: string } })
  | (CommandBase & { readonly kind: 'ADOPT_POLICY'; readonly options: { readonly axis: PolicyAxis; readonly choice: PolicyChoice } })
  | (CommandBase & {
      readonly kind: 'GOD_MOVE';
      readonly options: { readonly waypoints: readonly number[]; readonly routeMode: RouteMode; readonly then: FollowUp };
    })
  | (CommandBase & { readonly kind: 'GOD_FEED'; readonly options: Record<string, never> })
  | (CommandBase & { readonly kind: 'GOD_REST'; readonly options: Record<string, never> })
  | (CommandBase & { readonly kind: 'GOD_HOLD'; readonly options: Record<string, never> })
  | (CommandBase & { readonly kind: 'GOD_STANCE'; readonly options: { readonly stance: Stance } })
  | (CommandBase & { readonly kind: 'GOD_GUARD'; readonly options: { readonly targetSettlementId?: number } })
  | (CommandBase & { readonly kind: 'GOD_STRIKE'; readonly options: { readonly targetCell: number } })
  | (CommandBase & { readonly kind: 'GOD_CULTIVATE'; readonly options: { readonly targetCell: number; readonly adaptation?: string } })
  | (CommandBase & { readonly kind: 'GOD_ASSIST'; readonly options: { readonly settlementId: number; readonly service: 'CONSTRUCTION' | 'PROTECTION' | 'ECOLOGY' } })
  | (CommandBase & { readonly kind: 'RECRUIT_COMPANY'; readonly options: { readonly companyType: CompanyType; readonly armyId?: number | undefined } })
  | (CommandBase & { readonly kind: 'ARMY_MOVE'; readonly options: { readonly armyId: number; readonly targetCell?: number | undefined; readonly path?: readonly number[] | undefined } })
  | (CommandBase & { readonly kind: 'ARMY_STANCE'; readonly options: { readonly armyId: number; readonly stance: ArmyStance } })
  | (CommandBase & { readonly kind: 'DISBAND_ARMY'; readonly options: { readonly armyId: number } })
  | (CommandBase & {
      readonly kind: 'PROPOSE_TREATY';
      readonly options: {
        readonly recipientCivId: number;
        readonly clauses: readonly TreatyClause[];
        readonly durationTurns?: number | undefined;
        readonly terminationNoticeTurns?: number | undefined;
      };
    })
  | (CommandBase & { readonly kind: 'SIGN_TREATY'; readonly options: { readonly treatyId: number } })
  | (CommandBase & { readonly kind: 'CANCEL_TREATY'; readonly options: { readonly treatyId: number; readonly reason?: string | undefined } })
  | (CommandBase & { readonly kind: 'DECLARE_WAR'; readonly options: { readonly targetCivId: number } })
  | (CommandBase & { readonly kind: 'MAKE_PEACE'; readonly options: { readonly targetCivId: number } });

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
  if (build === 'FARM') {
    if (cell === null || !neighbors(state.map, settlement.cell).includes(cell)) return fail('UNSUPPORTED_STATE', 'FARM must target an adjacent cell');
    if (isWater(state.map, cell)) return fail('WRONG_DOMAIN', 'FARM cannot be built on water');
    if ((state.map.fertility[cell] as number) < WORLD_RULES.minFarmFertility) return fail('PREREQUISITE_MISSING', 'fertility below 250');
    const taken = state.settlements.some((other) => other.cell === cell || other.farmSites.some((site) => site.cell === cell)
      || other.queue.some((item) => item.kind === 'FARM' && item.cell === cell));
    if (taken) return fail('CAPACITY_REACHED', 'cell already holds a settlement or farm');
  } else if (build === 'ROAD') {
    if (cell === null) return fail('UNSUPPORTED_STATE', 'ROAD requires a target cell');
    if (isWater(state.map, cell)) return fail('WRONG_DOMAIN', 'ROAD cannot be built on water');
    if ((state.map.roads[cell] as number) > 0) return fail('CAPACITY_REACHED', 'cell already has a road');
    const queued = state.settlements.some((other) => other.queue.some((item) => item.kind === 'ROAD' && item.cell === cell));
    if (queued) return fail('CAPACITY_REACHED', 'road already queued for this cell');
  } else if (build === 'BRIDGE') {
    if (cell === null) return fail('UNSUPPORTED_STATE', 'BRIDGE requires a target cell');
    if (!isWater(state.map, cell)) return fail('WRONG_DOMAIN', 'BRIDGE must be built across water');
    if ((state.map.bridges[cell] as number) > 0) return fail('CAPACITY_REACHED', 'cell already has a bridge');
    const queued = state.settlements.some((other) => other.queue.some((item) => item.kind === 'BRIDGE' && item.cell === cell));
    if (queued) return fail('CAPACITY_REACHED', 'bridge already queued for this cell');
  } else {
    if (cell !== settlement.cell) return fail('UNSUPPORTED_STATE', `${build} targets its own settlement cell`);
    const districts = settlement.dwellings
      + (settlement.buildings?.granary ?? 0)
      + (settlement.buildings?.workshop ?? 0)
      + (settlement.buildings?.depot ?? 0)
      + (settlement.buildings?.archive ?? 0)
      + (settlement.buildings?.infirmary ?? 0);
    const planned = districts + settlement.queue.filter((item) => item.kind !== 'FARM' && item.kind !== 'ROAD' && item.kind !== 'BRIDGE').length;
    if (planned >= ECONOMY_RULES.maxDistrictParcels) return fail('CAPACITY_REACHED', 'all six district parcels are used');
  }
  for (const [resource, amount] of Object.entries(BUILD_RULES[build].materials)) {
    const key = resource as PhysicalResource;
    if (settlement.storage[key] < units(amount)) return fail('INSUFFICIENT_STOCK', `${build} needs ${amount} ${key}`);
  }
  return OK;
}

function validateFoundSettlement(state: CampaignState, settlement: SettlementState, target: number | null): ValidationResult {
  if (target === null || target < 0 || target >= state.map.elevation.length) {
    return fail('UNSUPPORTED_STATE', 'FOUND_SETTLEMENT requires a valid target cell');
  }
  if (isWater(state.map, target)) {
    return fail('WRONG_DOMAIN', 'settlement cannot be founded on water');
  }
  for (const other of state.settlements) {
    if (distance(state.map, other.cell, target) < WORLD_RULES.minSettlementSpacing) {
      return fail('BODY_BLOCKED', `settlement cores must be at least ${WORLD_RULES.minSettlementSpacing} steps apart`);
    }
  }
  if (state.settlements.some((s) => s.farmSites.some((f) => f.cell === target))) {
    return fail('CAPACITY_REACHED', 'target cell already holds a farm');
  }
  if (state.settlements.length >= ECONOMY_RULES.maxWorldSettlements) {
    return fail('CAPACITY_REACHED', 'world settlement envelope reached (96)');
  }
  const civCount = state.settlements.filter((s) => s.ownerId === settlement.ownerId).length;
  if (civCount >= ECONOMY_RULES.maxCivSettlements) {
    return fail('CAPACITY_REACHED', 'civilization settlement limit reached (16)');
  }
  if (settlement.populationMilli < 2000) {
    return fail('INSUFFICIENT_STOCK', 'settlement requires at least 2000 population to dispatch a founding party');
  }
  const cost = ECONOMY_RULES.foundingCost;
  if (settlement.storage.FOOD < units(cost.food)) {
    return fail('INSUFFICIENT_STOCK', `founding requires ${cost.food} FOOD rations`);
  }
  if (settlement.storage.TIMBER < units(cost.timber)) {
    return fail('INSUFFICIENT_STOCK', `founding requires ${cost.timber} TIMBER`);
  }
  if (settlement.storage.STONE < units(cost.stone)) {
    return fail('INSUFFICIENT_STOCK', `founding requires ${cost.stone} STONE`);
  }
  return OK;
}

function validateResearchTech(state: CampaignState, civId: number, techId: string): ValidationResult {
  const civ = state.civs.find((c) => c.id === civId);
  if (!civ) return fail('NOT_OWNER', 'unknown civilization');
  const tech = TECH_BY_ID.get(techId);
  if (!tech) return fail('UNSUPPORTED_STATE', `unknown technology ${techId}`);
  if (civ.completedTechs.includes(techId)) {
    return fail('CAPACITY_REACHED', `technology ${techId} already researched`);
  }
  if (!canResearchTech(civ.completedTechs, techId)) {
    return fail('PREREQUISITE_MISSING', `prerequisites not met for ${techId}`);
  }
  return OK;
}

function validateAdoptPolicy(state: CampaignState, civId: number, axis: PolicyAxis, choice: PolicyChoice): ValidationResult {
  const civ = state.civs.find((c) => c.id === civId);
  if (!civ) return fail('NOT_OWNER', 'unknown civilization');
  if (!POLICY_AXES.includes(axis)) return fail('UNSUPPORTED_STATE', `unknown policy axis ${axis}`);
  const legalChoices = POLICY_CHOICES[axis] as readonly string[];
  if (!legalChoices.includes(choice)) return fail('UNSUPPORTED_STATE', `illegal choice ${choice} for axis ${axis}`);

  if (axis !== 'RESOURCE_ETHICS' && axis !== 'SETTLEMENT_FORM') {
    if (!civ.completedTechs.includes('T-INS-2')) {
      return fail('PREREQUISITE_MISSING', 'axis requires T-INS-2 Civic Charters');
    }
  }

  if ((civ.policyCooldowns[axis] ?? 0) > 0) {
    return fail('CAPACITY_REACHED', `policy axis ${axis} is in cooldown for ${civ.policyCooldowns[axis]} more turns`);
  }

  if (civ.coin < units(POLICY_COST_COIN)) {
    return fail('INSUFFICIENT_STOCK', `adopting policy requires ${POLICY_COST_COIN} COIN`);
  }

  return OK;
}

export type ArmyCommand = Extract<
  Command,
  { kind: 'RECRUIT_COMPANY' | 'ARMY_MOVE' | 'ARMY_STANCE' | 'DISBAND_ARMY' }
>;

export function isArmyCommand(command: Command): command is ArmyCommand {
  return (
    command.kind === 'RECRUIT_COMPANY' ||
    command.kind === 'ARMY_MOVE' ||
    command.kind === 'ARMY_STANCE' ||
    command.kind === 'DISBAND_ARMY'
  );
}

function validateArmyCommand(state: CampaignState, command: ArmyCommand): ValidationResult {
  switch (command.kind) {
    case 'RECRUIT_COMPANY': {
      const settlement = state.settlements.find((s) => s.id === command.actorId);
      if (!settlement || settlement.ownerId !== command.civId) {
        return fail('NOT_OWNER', 'recruitment settlement not owned by this civilization');
      }
      const type = command.options.companyType;
      if (!COMPANY_TYPES.includes(type)) {
        return fail('UNSUPPORTED_STATE', `unknown company type ${type}`);
      }
      const spec = COMPANY_SPECS[type];
      const civ = state.civs.find((c) => c.id === command.civId);
      if (spec.requiredTech && !civ?.completedTechs.includes(spec.requiredTech)) {
        return fail('PREREQUISITE_MISSING', `company type ${type} requires technology ${spec.requiredTech}`);
      }
      if (settlement.populationMilli < 1200) {
        return fail('INSUFFICIENT_STOCK', 'settlement requires at least 1200 population to recruit troops');
      }
      if (settlement.storage.FOOD < units(spec.foodCost)) {
        return fail('INSUFFICIENT_STOCK', `recruiting ${type} requires ${spec.foodCost} FOOD`);
      }
      if (settlement.storage.TOOLS < units(spec.toolsCost)) {
        return fail('INSUFFICIENT_STOCK', `recruiting ${type} requires ${spec.toolsCost} TOOLS`);
      }
      if (command.options.armyId !== undefined) {
        const targetArmy = state.armies.find((a) => a.id === command.options.armyId);
        if (!targetArmy || targetArmy.ownerId !== command.civId) {
          return fail('NOT_OWNER', 'target army not owned by this civilization');
        }
        if (targetArmy.cell !== settlement.cell) {
          return fail('UNSUPPORTED_STATE', 'target army must be located at recruitment settlement');
        }
        if (targetArmy.companies.length >= ARMY_RULES.maxCompaniesPerArmy) {
          return fail('CAPACITY_REACHED', 'target army already has 6 companies');
        }
      }
      return OK;
    }
    case 'ARMY_MOVE': {
      const army = state.armies.find((a) => a.id === command.options.armyId);
      if (!army || army.ownerId !== command.civId) {
        return fail('NOT_OWNER', 'army not owned by this civilization');
      }
      if (army.stance === 'FORTIFY') {
        return fail('UNSUPPORTED_STATE', 'fortified army cannot move');
      }
      if (command.options.path && command.options.path.length > 0) {
        let current = army.cell;
        let totalAp = 0;
        for (const step of command.options.path) {
          if (!neighbors(state.map, current).includes(step)) {
            return fail('UNSUPPORTED_STATE', 'path steps must be adjacent neighbors');
          }
          const cost = terrainStepCost(state.map, current, step);
          if (cost === null) {
            return fail('BODY_BLOCKED', 'path crosses impassable terrain');
          }
          const passage = validateCellPassage(state, command.civId, step, false);
          if (!passage.ok) {
            return fail('RIGHTS_REQUIRED', passage.reason ?? 'territorial passage rights required');
          }
          totalAp += cost;
          current = step;
        }
        if (totalAp > army.apRemaining) {
          return fail('INSUFFICIENT_AP', `movement requires ${totalAp} AP, army has ${army.apRemaining}`);
        }
        return OK;
      } else if (command.options.targetCell !== undefined) {
        const target = command.options.targetCell;
        if (target < 0 || target >= state.map.elevation.length) {
          return fail('UNSUPPORTED_STATE', 'target cell out of bounds');
        }
        const pathRes = findPath({
          dims: state.map,
          from: army.cell,
          to: target,
          stepCost: (f, t) => {
            const passage = validateCellPassage(state, command.civId, t, false);
            if (!passage.ok) return null;
            return terrainStepCost(state.map, f, t);
          },
          minStepCost: 1,
          maxExpansions: 1000,
        });
        if (pathRes.kind !== 'FOUND') {
          return fail('BODY_BLOCKED', 'no path found to target cell');
        }
        if (pathRes.cost > army.apRemaining) {
          return fail('INSUFFICIENT_AP', `movement requires ${pathRes.cost} AP, army has ${army.apRemaining}`);
        }
        return OK;
      }
      return fail('UNSUPPORTED_STATE', 'ARMY_MOVE requires path or targetCell');
    }
    case 'ARMY_STANCE': {
      const army = state.armies.find((a) => a.id === command.options.armyId);
      if (!army || army.ownerId !== command.civId) {
        return fail('NOT_OWNER', 'army not owned by this civilization');
      }
      if (!ARMY_STANCES.includes(command.options.stance)) {
        return fail('UNSUPPORTED_STATE', `unknown stance ${command.options.stance}`);
      }
      return OK;
    }
    case 'DISBAND_ARMY': {
      const army = state.armies.find((a) => a.id === command.options.armyId);
      if (!army || army.ownerId !== command.civId) {
        return fail('NOT_OWNER', 'army not owned by this civilization');
      }
      return OK;
    }
  }
}

function validateDiplomacyCommand(state: CampaignState, command: DiplomacyCommand): ValidationResult {
  switch (command.kind) {
    case 'PROPOSE_TREATY': {
      const recipient = state.civs.find((c) => c.id === command.options.recipientCivId);
      if (!recipient || recipient.id === command.civId) {
        return fail('UNSUPPORTED_STATE', 'invalid treaty recipient');
      }
      if (command.options.clauses.length === 0) {
        return fail('UNSUPPORTED_STATE', 'treaty must contain at least one clause');
      }
      for (const clause of command.options.clauses) {
        if (!CLAUSE_IDS.includes(clause.id)) {
          return fail('UNSUPPORTED_STATE', `unknown clause ${clause.id}`);
        }
      }
      const existing = state.treaties.find(
        (t) =>
          t.status === 'ACTIVE' &&
          ((t.proposerCivId === command.civId && t.recipientCivId === recipient.id) ||
            (t.proposerCivId === recipient.id && t.recipientCivId === command.civId)),
      );
      if (existing) {
        return fail('CAPACITY_REACHED', 'active treaty already exists between these civilizations');
      }
      return OK;
    }
    case 'SIGN_TREATY': {
      const treaty = state.treaties.find((t) => t.id === command.options.treatyId);
      if (!treaty) {
        return fail('UNSUPPORTED_STATE', 'treaty not found');
      }
      if (treaty.status !== 'PROPOSED') {
        return fail('UNSUPPORTED_STATE', 'treaty is not in proposed status');
      }
      if (treaty.recipientCivId !== command.civId) {
        return fail('NOT_OWNER', 'only the recipient may sign this treaty');
      }
      return OK;
    }
    case 'CANCEL_TREATY': {
      const treaty = state.treaties.find((t) => t.id === command.options.treatyId);
      if (!treaty) {
        return fail('UNSUPPORTED_STATE', 'treaty not found');
      }
      if (treaty.status !== 'ACTIVE' && treaty.status !== 'PROPOSED') {
        return fail('UNSUPPORTED_STATE', 'treaty is not active or proposed');
      }
      if (treaty.proposerCivId !== command.civId && treaty.recipientCivId !== command.civId) {
        return fail('NOT_OWNER', 'not a party to this treaty');
      }
      return OK;
    }
    case 'DECLARE_WAR': {
      const target = state.civs.find((c) => c.id === command.options.targetCivId);
      if (!target || target.id === command.civId) {
        return fail('UNSUPPORTED_STATE', 'invalid target civilization for war');
      }
      const rel = getDiplomaticRelation(state, command.civId, target.id);
      if (rel?.atWar) {
        return fail('UNSUPPORTED_STATE', 'already at war');
      }
      return OK;
    }
    case 'MAKE_PEACE': {
      const target = state.civs.find((c) => c.id === command.options.targetCivId);
      if (!target || target.id === command.civId) {
        return fail('UNSUPPORTED_STATE', 'invalid target civilization for peace');
      }
      const rel = getDiplomaticRelation(state, command.civId, target.id);
      if (!rel?.atWar) {
        return fail('UNSUPPORTED_STATE', 'not currently at war');
      }
      return OK;
    }
  }
}

export type DiplomacyCommand = Extract<
  Command,
  { kind: 'PROPOSE_TREATY' | 'SIGN_TREATY' | 'CANCEL_TREATY' | 'DECLARE_WAR' | 'MAKE_PEACE' }
>;

export function isDiplomacyCommand(command: Command): command is DiplomacyCommand {
  return (
    command.kind === 'PROPOSE_TREATY' ||
    command.kind === 'SIGN_TREATY' ||
    command.kind === 'CANCEL_TREATY' ||
    command.kind === 'DECLARE_WAR' ||
    command.kind === 'MAKE_PEACE'
  );
}

export function validateCommand(state: CampaignState, command: Command): ValidationResult {
  if (command.expectedStateVersion !== state.turn || command.issuedForTurn !== state.turn + 1) {
    return fail('STALE_STATE', `command names state ${command.expectedStateVersion}/turn ${command.issuedForTurn}; current state ${state.turn}`);
  }
  if (!state.civs.some((civ) => civ.id === command.civId)) return fail('NOT_OWNER', 'unknown civilization');
  if (isGodCommand(command)) return validateGodCommand(state, command);
  if (isArmyCommand(command)) return validateArmyCommand(state, command);
  if (isDiplomacyCommand(command)) return validateDiplomacyCommand(state, command);
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
    case 'FOUND_SETTLEMENT':
      return validateFoundSettlement(state, settlement, command.target);
    case 'RESEARCH_TECH':
      return validateResearchTech(state, command.civId, command.options.techId);
    case 'ADOPT_POLICY':
      return validateAdoptPolicy(state, command.civId, command.options.axis, command.options.choice);
  }
}

function applyArmyCommand(state: CampaignState, command: ArmyCommand): void {
  switch (command.kind) {
    case 'RECRUIT_COMPANY': {
      const settlement = state.settlements.find((s) => s.id === command.actorId)!;
      const type = command.options.companyType;
      const spec = COMPANY_SPECS[type];

      settlement.storage.FOOD -= units(spec.foodCost);
      if (spec.toolsCost > 0) {
        settlement.storage.TOOLS -= units(spec.toolsCost);
      }
      settlement.populationMilli -= spec.populationMilliCost;

      // Trim any excess assigned jobs now that available labor dropped
      let excess = Object.values(settlement.jobs).reduce((sum, value) => sum + value, 0) - laborMilli(settlement);
      if (excess > 0) {
        const TRIM_ORDER = ['builder', 'quarry', 'forestry', 'farm'] as const;
        for (const job of TRIM_ORDER) {
          if (excess <= 0) break;
          const cut = Math.min(excess, settlement.jobs[job]);
          settlement.jobs[job] -= cut;
          excess -= cut;
        }
      }

      let army = command.options.armyId !== undefined
        ? state.armies.find((a) => a.id === command.options.armyId)
        : state.armies.find((a) => a.cell === settlement.cell && a.ownerId === settlement.ownerId && a.companies.length < ARMY_RULES.maxCompaniesPerArmy);

      if (!army) {
        const newArmyId = state.nextEntityId++;
        const civ = state.civs.find((c) => c.id === settlement.ownerId);
        army = {
          id: newArmyId,
          ownerId: settlement.ownerId,
          cell: settlement.cell,
          name: `${civ?.name ?? 'Civ'} Army ${newArmyId}`,
          companies: [],
          supplyReserve: 4,
          stance: 'DEFENSIVE',
          apRemaining: ARMY_RULES.baseAp,
          turnsWithoutSupply: 0,
        };
        state.armies.push(army);
      }

      const company: CompanyState = {
        id: state.nextEntityId++,
        type,
        strength: spec.baseStrength,
        cohesion: 100,
        equipment: 1000,
        rations: 2,
        populationMilli: spec.populationMilliCost,
        originSettlementId: settlement.id,
      };
      army.companies.push(company);

      state.history.push({
        eventId: state.history.length + 1,
        turn: state.turn,
        impulse: 0,
        type: 'ARMY_RECRUITED',
        actorIds: [settlement.ownerId, army.id],
        locationIds: [settlement.cell],
        causeIds: [],
        observerCivIds: [settlement.ownerId],
        payload: {
          armyId: army.id,
          settlementId: settlement.id,
          companyType: type,
        },
        schemaVersion: 1,
      });
      return;
    }
    case 'ARMY_MOVE': {
      const army = state.armies.find((a) => a.id === command.options.armyId)!;
      let steps: number[] = [];
      if (command.options.path && command.options.path.length > 0) {
        steps = [...command.options.path];
      } else if (command.options.targetCell !== undefined) {
        const pathRes = findPath({
          dims: state.map,
          from: army.cell,
          to: command.options.targetCell,
          stepCost: (f, t) => terrainStepCost(state.map, f, t),
          minStepCost: 1,
          maxExpansions: 1000,
        });
        if (pathRes.kind === 'FOUND') {
          steps = pathRes.cells.slice(1);
        }
      }

      let current = army.cell;
      for (const step of steps) {
        const cost = terrainStepCost(state.map, current, step) ?? 1;
        if (army.apRemaining < cost) break;
        army.apRemaining -= cost;

        const hostileArmy = state.armies.find((a) => a.cell === step && a.ownerId !== army.ownerId);
        if (hostileArmy) {
          const clash = resolveArmyClash(state, army, hostileArmy, current);
          state.history.push({
            eventId: state.history.length + 1,
            turn: state.turn,
            impulse: 0,
            type: 'ARMY_CLASH',
            actorIds: [army.id, hostileArmy.id],
            locationIds: [step],
            causeIds: [],
            observerCivIds: [army.ownerId, hostileArmy.ownerId],
            payload: {
              attackerId: army.id,
              defenderId: hostileArmy.id,
              attackerCasualties: clash.attackerCasualtiesMilli,
              defenderCasualties: clash.defenderCasualtiesMilli,
            },
            schemaVersion: 1,
          });

          if (clash.attackerRouted) {
            break;
          }
          if (clash.defenderRouted) {
            const retreatOptions = neighbors(state.map, step).filter(
              (n) => !isWater(state.map, n) && !state.armies.some((a) => a.cell === n && a.ownerId !== hostileArmy.ownerId),
            );
            if (retreatOptions.length > 0 && retreatOptions[0] !== undefined) {
              hostileArmy.cell = retreatOptions[0];
            } else {
              hostileArmy.companies = [];
            }
            current = step;
            army.cell = current;
          } else {
            // Defender held position; attacker cannot enter step cell
            break;
          }
        } else {
          current = step;
          army.cell = current;
        }
      }
      return;
    }
    case 'ARMY_STANCE': {
      const army = state.armies.find((a) => a.id === command.options.armyId)!;
      army.stance = command.options.stance;
      return;
    }
    case 'DISBAND_ARMY': {
      disbandArmy(state, command.options.armyId);
      return;
    }
  }
}

function applyDiplomacyCommand(state: CampaignState, command: DiplomacyCommand): void {
  switch (command.kind) {
    case 'PROPOSE_TREATY': {
      const treatyId = state.nextEntityId++;
      const eventId = state.history.length + 1;
      const newTreaty: Treaty = {
        id: treatyId,
        proposerCivId: command.civId,
        recipientCivId: command.options.recipientCivId,
        clauses: [...command.options.clauses],
        startTurn: state.turn,
        endTurn: command.options.durationTurns ? state.turn + command.options.durationTurns : null,
        terminationNoticeTurns: command.options.terminationNoticeTurns ?? 1,
        status: 'PROPOSED',
        causeEventId: eventId,
      };
      state.treaties.push(newTreaty);

      // Auto-sign if recipient is AI and not at war
      const recipientCiv = state.civs.find((c) => c.id === command.options.recipientCivId);
      const rel = getDiplomaticRelation(state, command.civId, command.options.recipientCivId);
      if (recipientCiv?.controller === 'AI' && (!rel || !rel.atWar)) {
        newTreaty.status = 'ACTIVE';
        adjustTrust(state, command.civId, command.options.recipientCivId, 100);
        state.history.push({
          eventId,
          turn: state.turn,
          impulse: 0,
          type: 'TREATY_SIGNED',
          actorIds: [command.civId, command.options.recipientCivId],
          locationIds: [],
          causeIds: [],
          observerCivIds: [command.civId, command.options.recipientCivId],
          payload: {
            treatyId,
            proposerCivId: command.civId,
            recipientCivId: command.options.recipientCivId,
          },
          schemaVersion: 1,
        });
      }
      return;
    }
    case 'SIGN_TREATY': {
      const treaty = state.treaties.find((t) => t.id === command.options.treatyId)!;
      treaty.status = 'ACTIVE';
      adjustTrust(state, treaty.proposerCivId, treaty.recipientCivId, 100);
      state.history.push({
        eventId: state.history.length + 1,
        turn: state.turn,
        impulse: 0,
        type: 'TREATY_SIGNED',
        actorIds: [treaty.proposerCivId, treaty.recipientCivId],
        locationIds: [],
        causeIds: [treaty.causeEventId],
        observerCivIds: [treaty.proposerCivId, treaty.recipientCivId],
        payload: {
          treatyId: treaty.id,
          proposerCivId: treaty.proposerCivId,
          recipientCivId: treaty.recipientCivId,
        },
        schemaVersion: 1,
      });
      return;
    }
    case 'CANCEL_TREATY': {
      const treaty = state.treaties.find((t) => t.id === command.options.treatyId)!;
      const wasActive = treaty.status === 'ACTIVE';
      treaty.status = 'TERMINATED';
      if (wasActive) {
        adjustTrust(state, treaty.proposerCivId, treaty.recipientCivId, -150);
        state.history.push({
          eventId: state.history.length + 1,
          turn: state.turn,
          impulse: 0,
          type: 'TREATY_BREACHED',
          actorIds: [command.civId],
          locationIds: [],
          causeIds: [treaty.causeEventId],
          observerCivIds: [treaty.proposerCivId, treaty.recipientCivId],
          payload: {
            treatyId: treaty.id,
            cancelledBy: command.civId,
          },
          schemaVersion: 1,
        });
      }
      return;
    }
    case 'DECLARE_WAR': {
      const rel = getDiplomaticRelation(state, command.civId, command.options.targetCivId);
      if (rel) {
        rel.atWar = true;
      }
      adjustTrust(state, command.civId, command.options.targetCivId, -800);
      for (const t of state.treaties) {
        if (
          t.status === 'ACTIVE' &&
          ((t.proposerCivId === command.civId && t.recipientCivId === command.options.targetCivId) ||
            (t.proposerCivId === command.options.targetCivId && t.recipientCivId === command.civId))
        ) {
          t.status = 'BREACHED';
        }
      }
      state.history.push({
        eventId: state.history.length + 1,
        turn: state.turn,
        impulse: 0,
        type: 'WAR_STARTED',
        actorIds: [command.civId, command.options.targetCivId],
        locationIds: [],
        causeIds: [],
        observerCivIds: [command.civId, command.options.targetCivId],
        payload: {
          aggressorCivId: command.civId,
          defenderCivId: command.options.targetCivId,
        },
        schemaVersion: 1,
      });
      return;
    }
    case 'MAKE_PEACE': {
      const rel = getDiplomaticRelation(state, command.civId, command.options.targetCivId);
      if (rel) {
        rel.atWar = false;
      }
      adjustTrust(state, command.civId, command.options.targetCivId, 300);
      state.history.push({
        eventId: state.history.length + 1,
        turn: state.turn,
        impulse: 0,
        type: 'WAR_ENDED',
        actorIds: [command.civId, command.options.targetCivId],
        locationIds: [],
        causeIds: [],
        observerCivIds: [command.civId, command.options.targetCivId],
        payload: {
          civA: command.civId,
          civB: command.options.targetCivId,
        },
        schemaVersion: 1,
      });
      return;
    }
  }
}

/** Applies an already validated command to mutable (cloned) state. */
export function applyCommand(state: CampaignState, command: Command): void {
  if (isGodCommand(command)) {
    applyGodCommand(state, command);
    return;
  }
  if (isArmyCommand(command)) {
    applyArmyCommand(state, command);
    return;
  }
  if (isDiplomacyCommand(command)) {
    applyDiplomacyCommand(state, command);
    return;
  }
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
    case 'FOUND_SETTLEMENT': {
      const targetCell = command.target as number;
      const cost = ECONOMY_RULES.foundingCost;
      settlement.populationMilli -= cost.populationMilli;
      settlement.storage.FOOD -= units(cost.food);
      settlement.storage.TIMBER -= units(cost.timber);
      settlement.storage.STONE -= units(cost.stone);

      // Trim any excess assigned jobs now that available labor dropped
      let excess = Object.values(settlement.jobs).reduce((sum, value) => sum + value, 0) - laborMilli(settlement);
      if (excess > 0) {
        const TRIM_ORDER = ['builder', 'quarry', 'forestry', 'farm'] as const;
        for (const job of TRIM_ORDER) {
          if (excess <= 0) break;
          const cut = Math.min(excess, settlement.jobs[job]);
          settlement.jobs[job] -= cut;
          excess -= cut;
        }
      }

      const newId = state.nextEntityId++;
      const civ = state.civs.find((c) => c.id === settlement.ownerId);
      const name = command.options.name || `${civ ? civ.name : 'Civilization'} Colony ${newId}`;
      const newSettlement: SettlementState = {
        id: newId,
        ownerId: settlement.ownerId,
        cell: targetCell,
        name,
        originalCapitalOf: null,
        populationMilli: cost.populationMilli,
        dwellings: 0,
        buildings: { granary: 0, workshop: 0, depot: 0, archive: 0, infirmary: 0 },
        hallIntegrity: 100,
        farmSites: [],
        jobs: { farm: 0, forestry: 0, quarry: 0, builder: 0 },
        storage: {
          FOOD: units(cost.food),
          TIMBER: 0,
          STONE: 0,
          ORE: 0,
          TOOLS: 0,
          MEDICINE: 0,
          BIO: 0,
        },
        carry: {},
        queue: [],
        welfare: 700,
        foodCoverage: 1000,
        shortageTurns: 0,
        legitimacy: ECONOMY_RULES.startingLegitimacy,
      };
      state.settlements.push(newSettlement);

      const eventId = state.history.length + 1;
      state.history.push({
        eventId,
        turn: state.turn,
        impulse: 0,
        type: 'CITY_FOUNDED',
        actorIds: [settlement.id, newId],
        locationIds: [targetCell],
        causeIds: [],
        observerCivIds: [settlement.ownerId],
        payload: {
          civId: settlement.ownerId,
          parentSettlementId: settlement.id,
          settlementId: newId,
          cell: targetCell,
        },
        schemaVersion: 1,
      });
      registerFoundingLandmark(state, newSettlement, eventId);
      return;
    }
    case 'RESEARCH_TECH': {
      const civ = state.civs.find((c) => c.id === command.civId)!;
      if (civ.currentResearch?.techId !== command.options.techId) {
        civ.currentResearch = { techId: command.options.techId, progress: 0 };
      }
      return;
    }
    case 'ADOPT_POLICY': {
      const civ = state.civs.find((c) => c.id === command.civId)!;
      civ.coin -= units(POLICY_COST_COIN);
      civ.policies[command.options.axis] = command.options.choice;
      civ.policyCooldowns[command.options.axis] = POLICY_COOLDOWN_TURNS;

      state.history.push({
        eventId: state.history.length + 1,
        turn: state.turn,
        impulse: 0,
        type: 'POLICY_ADOPTED',
        actorIds: [civ.id],
        locationIds: [],
        causeIds: [],
        observerCivIds: [civ.id],
        payload: {
          civId: civ.id,
          axis: command.options.axis,
          choice: command.options.choice,
        },
        schemaVersion: 1,
      });
      return;
    }
  }
}
