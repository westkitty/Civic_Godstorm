// Regenerates tests/fixtures/selfcheck.json from Node. Run only after a deliberate, reviewed
// rules/simulation change; the sim suite and browser journeys compare against this file.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSelfCheck, SELF_CHECK_OPTIONS } from '../../src/runtime/selfCheck.ts';
import { RULES_HASH, SIMULATION_VERSION } from '../../src/sim/data/rules.ts';

const result = runSelfCheck();
const fixture = { options: SELF_CHECK_OPTIONS, simulationVersion: SIMULATION_VERSION, rulesHash: RULES_HASH, ...result };
writeFileSync(resolve(import.meta.dirname, '../../tests/fixtures/selfcheck.json'), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(fixture);
