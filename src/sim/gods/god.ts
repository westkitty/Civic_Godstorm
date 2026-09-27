// God record (master Sections 4.1, 16.1). A God exists at exactly one place, is always selectable by
// its owner while alive, and changes only through validated commands and resolution.

import type { ConsentScope } from '../core/commands.ts';
import type { Quantity } from '../core/quantity.ts';
import { GOD_RULES } from '../data/rules.ts';
import { FAMILY_MASKS, maskFor, SIZE_RULES, type Genome } from './grammar.ts';
import type { BodyAction } from './sweep.ts';

export type Stance = 'CAREFUL' | 'NORMAL' | 'FORCEFUL';
export type RouteMode = 'SAFE' | 'DIRECT';
export type FollowUp = 'FEED' | 'REST' | null;

export interface PlanStep {
  readonly action: BodyAction;
  /** Pose after the step. */
  readonly anchor: number;
  readonly heading: number;
  /** AP cost known when planned (turns are free). */
  readonly ap: number;
}

export interface MoveOrder {
  readonly kind: 'MOVE';
  readonly commandId: string;
  readonly waypoints: number[];
  readonly routeMode: RouteMode;
  readonly then: FollowUp;
  readonly consent: ConsentScope;
  readonly plan: PlanStep[];
  /** Index of the next plan step to execute. */
  progress: number;
  /** AP already paid toward the next step (multi-impulse steps). */
  stepApPaid: number;
}

export type GuardOrder = { readonly kind: 'GUARD'; readonly targetSettlementId?: number | undefined };
export type StrikeOrder = { readonly kind: 'STRIKE'; readonly targetCell: number };
export type CultivateOrder = { readonly kind: 'CULTIVATE'; readonly targetCell: number; readonly adaptation?: string | undefined };
export type AssistOrder = { readonly kind: 'ASSIST'; readonly settlementId: number; readonly service: 'CONSTRUCTION' | 'PROTECTION' | 'ECOLOGY' };

export type GodOrder =
  | { readonly kind: 'HOLD' }
  | { readonly kind: 'FEED' }
  | { readonly kind: 'REST' }
  | GuardOrder
  | StrikeOrder
  | CultivateOrder
  | AssistOrder
  | MoveOrder;

export type OrderStatus =
  | { readonly kind: 'IDLE' }
  | { readonly kind: 'ACTIVE' }
  | { readonly kind: 'COMPLETE'; readonly turn: number }
  | { readonly kind: 'HALTED'; readonly turn: number; readonly reason: string; readonly cells: number[] };

export interface RegionHealth {
  core: number;
  locomotor: number;
  feeding: number;
  sensory: number;
  defensive: number;
}

import type { Wound, Scar } from './wounds.ts';

export interface GodState {
  readonly id: number;
  readonly ownerId: number;
  readonly lineageSeed: number;
  readonly genome: Genome;
  readonly maskName: string;
  anchor: number;
  heading: number;
  readonly domain: 'SURFACE';
  vitalHealth: number;
  regionHealth: RegionHealth;
  wounds: Wound[];
  scars: Scar[];
  fatigue: number;
  /** Nutrition reserve in hundredths. */
  reserve: Quantity;
  age: number;
  stance: Stance;
  order: GodOrder;
  status: OrderStatus;
  trust: number;
  lifecycle: 'ALIVE' | 'DEAD';
}

export function sizeRules(god: Pick<GodState, 'genome'>): (typeof SIZE_RULES)[1] {
  return SIZE_RULES[god.genome.size];
}

/** Section 4.6 & 4.7: AP available this turn given fatigue and locomotor injury. */
export function apForFatigue(
  fatigue: number,
  god?: { readonly regionHealth?: RegionHealth | undefined; readonly wounds?: readonly Wound[] | undefined },
): number {
  let ap: number = GOD_RULES.apPerTurn;
  for (const band of GOD_RULES.fatigueAp) {
    if (fatigue >= band.atLeast) {
      ap = band.ap;
      break;
    }
  }
  if (god) {
    const hasLocoDamage =
      (god.regionHealth ? god.regionHealth.locomotor <= 200 : false) ||
      (god.wounds ? god.wounds.some((w) => w.region === 'locomotor' && (w.type === 'FRACTURE' || w.type === 'LOST_STRUCTURE')) : false);
    if (hasLocoDamage) {
      ap = Math.max(0, ap - 1);
    }
  }
  return ap;
}

export function createGod(options: {
  id: number;
  ownerId: number;
  lineageSeed: number;
  genome: Genome;
  anchor: number;
  heading: number;
}): GodState {
  if (options.genome.family === 'S') throw new Error('S ordered-trail bodies arrive with M06');
  maskFor(options.genome);
  const size = SIZE_RULES[options.genome.size];
  return {
    id: options.id,
    ownerId: options.ownerId,
    lineageSeed: options.lineageSeed,
    genome: options.genome,
    maskName: FAMILY_MASKS[options.genome.family][options.genome.size],
    anchor: options.anchor,
    heading: options.heading,
    domain: 'SURFACE',
    vitalHealth: size.health,
    regionHealth: { core: GOD_RULES.regionHealth, locomotor: GOD_RULES.regionHealth, feeding: GOD_RULES.regionHealth, sensory: GOD_RULES.regionHealth, defensive: GOD_RULES.regionHealth },
    wounds: [],
    scars: [],
    fatigue: 0,
    reserve: size.upkeep * GOD_RULES.startingReserveTurns * 100,
    age: 0,
    stance: 'NORMAL',
    order: { kind: 'HOLD' },
    status: { kind: 'IDLE' },
    trust: GOD_RULES.startingTrust,
    lifecycle: 'ALIVE',
  };
}
