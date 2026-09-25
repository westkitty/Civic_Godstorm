// Shared argument surface for validation entry points (master Section 19.1): every test/benchmark
// runner accepts a seed, map size, scenario, turn count and output directory. Invalid input is a
// usage error, never silently defaulted.

export type MapSize = 'small' | 'standard' | 'large';

export interface RunnerArgs {
  readonly seed: string;
  readonly map: MapSize;
  readonly scenario: string | null;
  readonly turns: number;
  readonly out: string;
  /** Optional: independent seeded runs (seed suffixes -0..-n-1). */
  readonly runs: number;
  /** Optional: civilizations including the human, 1-6. */
  readonly civs: number;
}

export class UsageError extends Error {
  override readonly name = 'UsageError';
}

/** Section 16.7: 1-64 ASCII letters, digits, dot, underscore, colon or hyphen. */
export const SEED_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
/** Section 1.1/2.5: 240-turn campaigns with supported continuation to turn 1,000. */
export const MAX_TURNS = 1000;
const MAP_SIZES: readonly MapSize[] = ['small', 'standard', 'large'];

export function parseRunnerArgs(argv: readonly string[], defaults: RunnerArgs): RunnerArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (!token.startsWith('--')) throw new UsageError(`Unexpected argument "${token}"`);
    const [flag, inline] = token.slice(2).split('=', 2) as [string, string | undefined];
    if (!['seed', 'map', 'scenario', 'turns', 'out', 'runs', 'civs'].includes(flag)) throw new UsageError(`Unknown option --${flag}`);
    const value = inline ?? argv[++index];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`Option --${flag} needs a value`);
    values.set(flag, value);
  }

  const seed = values.get('seed') ?? defaults.seed;
  if (!SEED_PATTERN.test(seed)) throw new UsageError(`Invalid seed "${seed}" (1-64 of A-Z a-z 0-9 . _ : -)`);

  const map = (values.get('map') ?? defaults.map) as MapSize;
  if (!MAP_SIZES.includes(map)) throw new UsageError(`Invalid map "${map}" (small|standard|large)`);

  const turnsText = values.get('turns');
  const turns = turnsText === undefined ? defaults.turns : Number(turnsText);
  if (!Number.isInteger(turns) || turns < 1 || turns > MAX_TURNS) {
    throw new UsageError(`Invalid turns "${turnsText ?? turns}" (integer 1-${MAX_TURNS})`);
  }

  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const text = values.get(name);
    const value = text === undefined ? fallback : Number(text);
    if (!Number.isInteger(value) || value < min || value > max) throw new UsageError(`Invalid ${name} "${text ?? value}" (integer ${min}-${max})`);
    return value;
  };

  return {
    seed,
    map,
    scenario: values.get('scenario') ?? defaults.scenario,
    turns,
    out: values.get('out') ?? defaults.out,
    runs: integer('runs', defaults.runs, 1, 1000),
    civs: integer('civs', defaults.civs, 1, 6),
  };
}
