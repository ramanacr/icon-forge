import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalNumber } from './canonical.js';

describe('canonical serialization', () => {
  it('sorts object keys recursively and preserves array order', () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: true }))
      .toBe('{"a":true,"z":[{"a":1,"b":2}]}');
  });

  it('formats numbers without exponent notation or negative zero', () => {
    expect(canonicalNumber(1e-7)).toBe('0.0000001');
    expect(canonicalNumber(1e21)).toBe('1000000000000000000000');
    expect(canonicalNumber(-0)).toBe('0');
  });

  it('rejects unsupported values rather than silently dropping fields', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson(Number.NaN)).toThrow();
  });
});
