import { describe, expect, it } from 'vitest';
import { decodeSave, encodeSave, SaveRejected, serializeSaveFile } from '../../src/persistence/envelope.ts';
import { runHeadlessCampaign } from '../../src/sim/headless.ts';
import { PHYSICAL_RESOURCES } from '../../src/sim/data/rules.ts';

const RUNS = 50;
const TURNS = 30;

describe(`${RUNS} seeded ${TURNS}-turn headless campaigns (M01 exit)`, () => {
  it('rerun to identical hash sequences, keep invariants and differ between seeds', () => {
    const finals = new Set<string>();
    for (let run = 0; run < RUNS; run += 1) {
      const options = { seed: `m01-run-${run}`, size: 'standard' as const, civCount: 6, turns: TURNS };
      const first = runHeadlessCampaign(options);
      const second = runHeadlessCampaign(options);
      expect(second.hashes).toEqual(first.hashes);
      expect(first.hashes).toHaveLength(TURNS + 1);
      expect(first.rejections).toBe(0);
      for (const settlement of first.state.settlements) {
        expect(settlement.populationMilli).toBeGreaterThan(0);
        for (const resource of PHYSICAL_RESOURCES) expect(settlement.storage[resource]).toBeGreaterThanOrEqual(0);
      }
      finals.add(first.hashes.at(-1) ?? '');
    }
    expect(finals.size).toBe(RUNS);
  }, 120_000);

  it('round-trips a committed save to the same state hash and rejects corruption', () => {
    const { state, hashes } = runHeadlessCampaign({ seed: 'save-1', size: 'small', civCount: 2, turns: 12 });
    const text = serializeSaveFile(encodeSave(state));
    const restored = decodeSave(text);
    const resumed = runHeadlessCampaign({ seed: 'save-1', size: 'small', civCount: 2, turns: 20 });
    const continued = runHeadlessCampaign({ seed: 'save-1', size: 'small', civCount: 2, turns: 8, from: restored });
    expect(continued.hashes[0]).toBe(hashes.at(-1));
    expect(continued.hashes.at(-1)).toBe(resumed.hashes.at(-1));

    const file = JSON.parse(text) as { envelope: unknown; payload: string };
    const tampered = JSON.stringify({ ...file, payload: file.payload.replace('"populationMilli":', '"populationMilli":1') });
    expect(tampered).not.toBe(text);
    expect(() => decodeSave(tampered)).toThrow(SaveRejected);
    const future = text.replace('"formatVersion":1', '"formatVersion":9');
    expect(() => decodeSave(future)).toThrow(/newer/);
    expect(() => decodeSave('{')).toThrow(SaveRejected);
  });
});
