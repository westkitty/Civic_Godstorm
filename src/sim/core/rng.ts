// CG-XOR32-v1 (master Section 16.7). A game random stream, not a security primitive.

export const STREAM_NAMES = ['WORLD', 'STARTS', 'ECOLOGY', 'AI-PERSONALITY'] as const;
export type StreamName = (typeof STREAM_NAMES)[number];
export type RngStreams = Record<StreamName, number>;

/** Replacement for a zero state, which xorshift can never leave. */
export const ZERO_STATE_REPLACEMENT = 0x6d2b79f5;

export const SEED_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export class InvalidSeedError extends Error {
  override readonly name = 'InvalidSeedError';
}

export function assertSeed(seed: string): void {
  if (!SEED_PATTERN.test(seed)) {
    throw new InvalidSeedError(`Seed must be 1-64 ASCII characters from A-Z a-z 0-9 . _ : - (got "${seed}")`);
  }
}

/** FNV-1a 32-bit over ASCII bytes with exact modulo-2^32 multiplication. */
export function fnv1a32(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0x7f) throw new InvalidSeedError('FNV-1a stream input must be ASCII');
    hash ^= code;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function normalizeState(state: number): number {
  const value = state >>> 0;
  return value === 0 ? ZERO_STATE_REPLACEMENT : value;
}

/** One xorshift step; returns the new state, which is also the output. */
export function xor32Next(state: number): number {
  let x = state >>> 0;
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  return x;
}

export function initStreams(seed: string): RngStreams {
  assertSeed(seed);
  const streams = {} as RngStreams;
  for (const name of STREAM_NAMES) streams[name] = normalizeState(fnv1a32(`${seed}:${name}`));
  return streams;
}

/** Mutable cursor over one named stream stored inside simulation state. */
export class RngCursor {
  private readonly streams: RngStreams;
  private readonly name: StreamName;

  constructor(streams: RngStreams, name: StreamName) {
    this.streams = streams;
    this.name = name;
  }

  nextU32(): number {
    const next = xor32Next(this.streams[this.name]);
    this.streams[this.name] = next;
    return next;
  }

  /** Uniform integer in [0, n) by rejection of draws >= floor(2^32 / n) * n. */
  nextBelow(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw new RangeError(`nextBelow bound ${n} invalid`);
    const limit = Math.floor(0x100000000 / n) * n;
    for (;;) {
      const draw = this.nextU32();
      if (draw < limit) return draw % n;
    }
  }
}
