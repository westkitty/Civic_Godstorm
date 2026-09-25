// npm run bench -- --seed <s> --map <small|standard|large> --scenario <id> --turns <n> --out <dir>
import { runUnavailable } from './unavailable.ts';

runUnavailable(
  'bench',
  'No measurable workload exists yet; Section 15 benchmarks are implemented and measured in M12.',
  { seed: 'cg-default', map: 'standard', scenario: 'stress', turns: 240, out: 'artifacts/local/bench', runs: 1, civs: 6 },
);
