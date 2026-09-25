import { describe, expect, it } from 'vitest';
import { parseRunnerArgs, UsageError, type RunnerArgs } from '../../tools/cli/args.ts';

const defaults: RunnerArgs = { seed: 'cg-default', map: 'standard', scenario: null, turns: 240, out: 'out', runs: 1, civs: 6 };

describe('parseRunnerArgs', () => {
  it('accepts every documented option in both spellings', () => {
    expect(parseRunnerArgs(['--seed', 'A.b_c:1-2', '--map=small', '--scenario', 'C07', '--turns', '30', '--out=x'], defaults))
      .toEqual({ seed: 'A.b_c:1-2', map: 'small', scenario: 'C07', turns: 30, out: 'x', runs: 1, civs: 6 });
  });

  it('keeps defaults when options are absent', () => {
    expect(parseRunnerArgs([], defaults)).toEqual(defaults);
  });

  it.each([
    [['--seed', 'bad seed']],
    [['--seed', 'x'.repeat(65)]],
    [['--map', 'huge']],
    [['--turns', '0']],
    [['--turns', '1001']],
    [['--turns', '2.5']],
    [['--colour', 'red']],
    [['--runs', '0']],
    [['--civs', '7']],
    [['--seed']],
    [['stray']],
  ])('rejects invalid input %j', (argv) => {
    expect(() => parseRunnerArgs(argv, defaults)).toThrow(UsageError);
  });
});
