import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSelfCheck, SELF_CHECK_OPTIONS } from '../../src/runtime/selfCheck.ts';
import { RULES_HASH, SIMULATION_VERSION } from '../../src/sim/data/rules.ts';

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/selfcheck.json'), 'utf8')) as Record<string, unknown>;

describe('Node determinism self-check fixture', () => {
  it('matches the committed fixture that browsers are compared against', () => {
    expect(fixture.options).toEqual(SELF_CHECK_OPTIONS);
    expect(fixture.rulesHash).toBe(RULES_HASH);
    expect(fixture.simulationVersion).toBe(SIMULATION_VERSION);
    const result = runSelfCheck();
    expect(result.goldenVectorsPass).toBe(true);
    expect(result.initialHash).toBe(fixture.initialHash);
    expect(result.finalHash).toBe(fixture.finalHash);
  });
});
