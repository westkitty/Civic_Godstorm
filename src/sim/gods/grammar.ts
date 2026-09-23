// God composition grammar (master Sections 4.2, 4.3, 16.3, 16.6). Pure data plus a validator; a
// genome is a validated composition, never independent random picks. Illegal combinations are
// rejected, not cosmetically hidden.

import { MASKS, type MaskName } from '../world/hex.ts';

export const FAMILIES = ['Q', 'H', 'S', 'M'] as const;
export type Family = (typeof FAMILIES)[number];
export const LOCOMOTORS = ['PILLAR', 'WEBBED', 'DIGGER', 'UNDULATOR', 'FIN', 'WING'] as const;
export type Locomotor = (typeof LOCOMOTORS)[number];
export const FEEDING = ['BROWSE', 'FILTER', 'MINERAL', 'CARRION'] as const;
export type Feeding = (typeof FEEDING)[number];
export const SENSORS = ['EYE-RING', 'ANTENNA-CROWN', 'VIBRATION-ROSETTE'] as const;
export type Sensor = (typeof SENSORS)[number];
export const TAILS = ['NONE', 'BALANCE', 'PADDLE', 'WEDGE'] as const;
export type Tail = (typeof TAILS)[number];
export const ARMORS = ['NONE', 'OSTEODERM', 'SHELL', 'COAT'] as const;
export type Armor = (typeof ARMORS)[number];
export const ORGANS = ['NONE', 'GILLS', 'SOLAR-SAIL', 'THERMAL-VENT', 'SPORE-SAC'] as const;
export type Organ = (typeof ORGANS)[number];
export const SYMBIOSES = ['NONE', 'FUNGAL-GROVE', 'FOLLOWER-GALLERY', 'ROOT-HOLDFAST'] as const;
export type Symbiosis = (typeof SYMBIOSES)[number];
export type BodySize = 1 | 2 | 3;

export interface Genome {
  readonly family: Family;
  readonly locomotor: Locomotor;
  readonly feeding: Feeding;
  readonly sensor: Sensor;
  readonly tail: Tail;
  readonly armor: Armor;
  readonly organ: Organ;
  readonly symbiosis: Symbiosis;
  readonly size: BodySize;
}

/** Section 4.2 family table: nine legal family/primary-locomotor pairings. */
export const FAMILY_LOCOMOTORS: Readonly<Record<Family, readonly Locomotor[]>> = {
  Q: ['PILLAR', 'WEBBED', 'DIGGER'],
  H: ['PILLAR', 'DIGGER'],
  S: ['UNDULATOR', 'FIN'],
  M: ['FIN', 'WING'],
};

export const FAMILY_TAILS: Readonly<Record<Family, readonly Tail[]>> = {
  Q: ['BALANCE', 'PADDLE'],
  H: ['NONE', 'WEDGE'],
  S: ['BALANCE', 'PADDLE', 'WEDGE'],
  M: ['PADDLE', 'BALANCE'],
};

/** Section 4.3 size table. Nutrition values are whole units. */
export const SIZE_RULES: Readonly<Record<BodySize, { mass: number; upkeep: number; reserve: number; health: number }>> = {
  1: { mass: 1, upkeep: 8, reserve: 48, health: 800 },
  2: { mass: 2, upkeep: 16, reserve: 96, health: 1200 },
  3: { mass: 4, upkeep: 32, reserve: 192, health: 1600 },
};

/** Section 4.3/16.2 rigid masks by family and size. S uses ordered trails (not rigid masks). */
export const FAMILY_MASKS: Readonly<Record<Exclude<Family, 'S'>, Readonly<Record<BodySize, MaskName>>>> = {
  Q: { 1: 'TWO', 2: 'TRIANGLE', 3: 'DISC7' },
  H: { 1: 'TRIANGLE', 2: 'RHOMBUS', 3: 'DISC7' },
  M: { 1: 'FAN3', 2: 'FAN5', 3: 'DISC7' },
};

/** Section 16.3: own-God sight radius by sensor. */
export const SENSOR_SIGHT: Readonly<Record<Sensor, number>> = {
  'EYE-RING': 3,
  'ANTENNA-CROWN': 4,
  'VIBRATION-ROSETTE': 2,
};

export type GenomeProblem = string;

/** Returns every violated grammar rule; an empty list means the genome is legal. */
export function genomeProblems(genome: Genome): GenomeProblem[] {
  const problems: GenomeProblem[] = [];
  const { family, locomotor, feeding, tail, armor, organ, symbiosis, size } = genome;
  if (!FAMILY_LOCOMOTORS[family].includes(locomotor)) problems.push(`${family} cannot use ${locomotor}`);
  if (!FAMILY_TAILS[family].includes(tail)) problems.push(`${family} cannot carry tail ${tail}`);
  const feedingOk: Record<Family, boolean> = {
    M: feeding === 'FILTER' || feeding === 'CARRION',
    Q: feeding === 'BROWSE' || feeding === 'MINERAL' || feeding === 'CARRION' || (feeding === 'FILTER' && locomotor === 'WEBBED'),
    H: feeding === 'BROWSE' || feeding === 'MINERAL' || feeding === 'CARRION',
    S: true,
  };
  if (!feedingOk[family]) problems.push(`${family}/${locomotor} cannot use ${feeding} feeding`);
  if (feeding === 'FILTER' && !(locomotor === 'FIN' || locomotor === 'WEBBED')) problems.push('FILTER requires FIN or WEBBED');
  if (locomotor === 'WING' && (armor === 'SHELL' || armor === 'OSTEODERM')) problems.push('WING forbids SHELL and OSTEODERM');
  if (locomotor === 'WING' && (symbiosis === 'FOLLOWER-GALLERY' || symbiosis === 'ROOT-HOLDFAST')) problems.push('WING forbids galleries and holdfast');
  if (locomotor === 'DIGGER' && (organ === 'SOLAR-SAIL' || symbiosis === 'FUNGAL-GROVE')) problems.push('DIGGER forbids exposed sails and groves');
  if (locomotor === 'WING' && size === 3) problems.push('WING is size I/II only');
  return problems;
}

export function maskFor(genome: Genome): readonly { q: number; r: number }[] {
  if (genome.family === 'S') throw new Error('S bodies use ordered trails; rigid mask requested');
  return MASKS[FAMILY_MASKS[genome.family][genome.size]];
}

/** The M02 prototype body: the first-God family Q in its baseline configuration. */
export const STARTING_GENOME_Q: Genome = {
  family: 'Q',
  locomotor: 'PILLAR',
  feeding: 'BROWSE',
  sensor: 'EYE-RING',
  tail: 'BALANCE',
  armor: 'NONE',
  organ: 'NONE',
  symbiosis: 'NONE',
  size: 1,
};
