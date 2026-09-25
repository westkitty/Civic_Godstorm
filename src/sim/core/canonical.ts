// Canonical serialisation for hashing and saves (master Section 13.2): object keys sorted, only
// safe integers, strings, booleans, null, arrays and plain objects. Floats, NaN, undefined, Maps,
// class instances and typed arrays are rejected so hidden nondeterminism cannot enter a hash.

import { sha256Text } from './sha256.ts';

export class CanonicalValueError extends Error {
  override readonly name = 'CanonicalValueError';
}

function encode(value: unknown, path: string, out: string[]): void {
  if (value === null) {
    out.push('null');
    return;
  }
  switch (typeof value) {
    case 'number':
      if (!Number.isSafeInteger(value)) throw new CanonicalValueError(`${path}: non-integer or unsafe number ${value}`);
      out.push(Object.is(value, -0) ? '0' : String(value));
      return;
    case 'string':
      out.push(JSON.stringify(value));
      return;
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'object': {
      if (Array.isArray(value)) {
        // Fast path for integer arrays (map fields); String(-0) is "0", matching the scalar case.
        if (value.every((item) => typeof item === 'number' && Number.isSafeInteger(item))) {
          out.push('[', value.join(','), ']');
          return;
        }
        out.push('[');
        value.forEach((item, index) => {
          if (index > 0) out.push(',');
          encode(item, `${path}[${index}]`, out);
        });
        out.push(']');
        return;
      }
      const prototype = Object.getPrototypeOf(value) as unknown;
      if (prototype !== Object.prototype && prototype !== null) {
        throw new CanonicalValueError(`${path}: unsupported object type`);
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      out.push('{');
      keys.forEach((key, index) => {
        if (record[key] === undefined) throw new CanonicalValueError(`${path}.${key}: undefined`);
        if (index > 0) out.push(',');
        out.push(JSON.stringify(key), ':');
        encode(record[key], `${path}.${key}`, out);
      });
      out.push('}');
      return;
    }
    default:
      throw new CanonicalValueError(`${path}: unsupported ${typeof value}`);
  }
}

export function canonicalize(value: unknown): string {
  const out: string[] = [];
  encode(value, '$', out);
  return out.join('');
}

export function canonicalHash(value: unknown): string {
  return sha256Text(canonicalize(value));
}
