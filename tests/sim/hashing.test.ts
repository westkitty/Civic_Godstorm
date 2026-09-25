import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalize, CanonicalValueError } from '../../src/sim/core/canonical.ts';
import { initStreams, RngCursor } from '../../src/sim/core/rng.ts';
import { sha256Bytes, sha256Text } from '../../src/sim/core/sha256.ts';

describe('pure SHA-256', () => {
  it('matches node:crypto across lengths and block boundaries', () => {
    const cursor = new RngCursor(initStreams('sha'), 'WORLD');
    for (let length = 0; length < 300; length += 1) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = cursor.nextBelow(256);
      expect(sha256Bytes(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });

  it('hashes UTF-8 text like node:crypto', () => {
    for (const text of ['', 'abc', 'Godstorm ✦ ÄÖÜ', 'x'.repeat(10000)]) {
      expect(sha256Text(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});

describe('canonical serialisation', () => {
  it('is independent of key insertion order', () => {
    expect(canonicalize({ b: 1, a: [2, { d: 3, c: 'x' }] })).toBe(canonicalize({ a: [2, { c: 'x', d: 3 }], b: 1 }));
    expect(canonicalHash({ z: 0, y: -0 })).toBe(canonicalHash({ y: 0, z: 0 }));
  });

  it('rejects values that would hide nondeterminism', () => {
    for (const bad of [{ a: 0.5 }, { a: Number.NaN }, { a: undefined }, { a: new Map() }, { a: new Int32Array(2) }, { a: 2 ** 60 }]) {
      expect(() => canonicalize(bad)).toThrow(CanonicalValueError);
    }
  });
});
