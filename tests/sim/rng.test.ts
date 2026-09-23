import { describe, expect, it } from 'vitest';
import {
  assertSeed,
  fnv1a32,
  initStreams,
  InvalidSeedError,
  normalizeState,
  RngCursor,
  xor32Next,
  ZERO_STATE_REPLACEMENT,
} from '../../src/sim/core/rng.ts';

describe('CG-XOR32-v1', () => {
  it('reproduces the Section 16.7 golden vectors from state 1', () => {
    const outputs: number[] = [];
    let state = 1;
    for (let i = 0; i < 5; i += 1) {
      state = xor32Next(state);
      outputs.push(state);
    }
    expect(outputs).toEqual([270369, 67634689, 2647435461, 307599695, 2398689233]);
  });

  it('replaces a zero state and keeps outputs unsigned 32-bit', () => {
    expect(normalizeState(0)).toBe(ZERO_STATE_REPLACEMENT);
    let state = 0xffffffff;
    for (let i = 0; i < 1000; i += 1) {
      state = xor32Next(state);
      expect(state).toBeGreaterThanOrEqual(0);
      expect(state).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(state)).toBe(true);
    }
  });

  it('hashes stream names with FNV-1a 32-bit', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
    const streams = initStreams('seed-1');
    expect(streams.WORLD).toBe(fnv1a32('seed-1:WORLD'));
    expect(new Set(Object.values(streams)).size).toBe(4);
  });

  it('bounds draws with rejection sampling and stays within [0, n)', () => {
    const streams = initStreams('bounds');
    const cursor = new RngCursor(streams, 'ECOLOGY');
    const counts = new Array<number>(7).fill(0);
    for (let i = 0; i < 7000; i += 1) {
      const value = cursor.nextBelow(7);
      counts[value] = (counts[value] as number) + 1;
    }
    expect(counts.every((count) => count > 800 && count < 1200)).toBe(true);
    expect(() => cursor.nextBelow(0)).toThrow(RangeError);
  });

  it('keeps named streams independent', () => {
    const a = initStreams('indep');
    const b = initStreams('indep');
    new RngCursor(a, 'WORLD').nextU32();
    new RngCursor(a, 'WORLD').nextU32();
    expect(new RngCursor(a, 'STARTS').nextU32()).toBe(new RngCursor(b, 'STARTS').nextU32());
  });

  it('validates the seed alphabet and length', () => {
    expect(() => assertSeed('ok.seed_1:2-3')).not.toThrow();
    for (const bad of ['', 'has space', 'x'.repeat(65), 'naïve']) expect(() => assertSeed(bad)).toThrow(InvalidSeedError);
  });
});
