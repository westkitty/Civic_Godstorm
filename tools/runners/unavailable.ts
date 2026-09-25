// Entry points whose implementation belongs to a later milestone. They validate their arguments so
// the interface is fixed now, then exit nonzero: an absent gate must never read as a passing one.

import { parseRunnerArgs, UsageError, type RunnerArgs } from '../cli/args.ts';

export const EXIT_USAGE = 64;
export const EXIT_NOT_IMPLEMENTED = 2;

export function runUnavailable(name: string, owner: string, defaults: RunnerArgs): never {
  let args: RunnerArgs;
  try {
    args = parseRunnerArgs(process.argv.slice(2), defaults);
  } catch (error: unknown) {
    if (error instanceof UsageError) {
      console.error(`${name}: ${error.message}`);
      process.exit(EXIT_USAGE);
    }
    throw error;
  }
  console.error(`${name}: NOT AVAILABLE. ${owner}`);
  console.error(`${name}: arguments accepted: ${JSON.stringify(args)}`);
  process.exit(EXIT_NOT_IMPLEMENTED);
}
