// npm run test:campaigns -- --seed <s> --map <small|standard|large> --scenario <id> --turns <n> --out <dir>
import { runUnavailable } from './unavailable.ts';

runUnavailable(
  'test:campaigns',
  'No simulation kernel exists yet; seeded headless runs arrive with M01 and full campaign suites with M08/M13.',
  { seed: 'cg-default', map: 'standard', scenario: null, turns: 240, out: 'artifacts/local/campaigns' },
);
