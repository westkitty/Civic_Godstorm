// npm run test:campaigns -- --seed <s> --map <small|standard|large> --turns <n> --runs <n> --civs <n> --out <dir>
// Seeded headless campaigns through the real command/turn pipeline (M01: scripted baseline driver).
// Each run executes twice; any hash-sequence difference or invariant violation exits nonzero.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runHeadlessCampaign } from '../../src/sim/headless.ts';
import { parseRunnerArgs, UsageError, type RunnerArgs } from '../cli/args.ts';

const defaults: RunnerArgs = { seed: 'cg-campaign', map: 'standard', scenario: 'baseline', turns: 30, out: 'artifacts/local/campaigns', runs: 50, civs: 6 };

let args: RunnerArgs;
try {
  args = parseRunnerArgs(process.argv.slice(2), defaults);
} catch (error: unknown) {
  if (error instanceof UsageError) {
    console.error(`test:campaigns: ${error.message}`);
    process.exit(64);
  }
  throw error;
}
if (args.scenario !== 'baseline') {
  console.error(`test:campaigns: scenario "${args.scenario ?? ''}" is not available; only "baseline" exists before the Section 20 scenarios (M11).`);
  process.exit(2);
}

const started = performance.now();
const runs = [];
let mismatches = 0;
for (let index = 0; index < args.runs; index += 1) {
  const options = { seed: `${args.seed}-${index}`, size: args.map, civCount: args.civs, turns: args.turns };
  const first = runHeadlessCampaign(options);
  const second = runHeadlessCampaign(options);
  const identical = first.hashes.length === second.hashes.length && first.hashes.every((hash, i) => hash === second.hashes[i]);
  if (!identical) mismatches += 1;
  runs.push({
    seed: options.seed,
    identicalRerun: identical,
    finalHash: first.hashes.at(-1),
    rejections: first.rejections,
    settlements: first.state.settlements.map((s) => ({ id: s.id, populationMilli: s.populationMilli, dwellings: s.dwellings, farms: s.farmSites.length })),
    hashes: first.hashes,
  });
  console.log(`${identical ? 'PASS' : 'FAIL'}  ${options.seed}  ${first.hashes.at(-1) ?? ''}  rejections=${first.rejections}`);
}
const seconds = ((performance.now() - started) / 1000).toFixed(1);

const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const report = { args, runtime: `node ${process.version}`, mismatches, runs };
writeFileSync(resolve(out, 'campaigns.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${args.runs} runs x ${args.turns} turns (${args.map}, ${args.civs} civs), each run twice, in ${seconds}s; report ${out}/campaigns.json`);
if (mismatches > 0) {
  console.error(`test:campaigns FAILED: ${mismatches} runs diverged on rerun`);
  process.exit(1);
}
console.log('test:campaigns PASSED');
