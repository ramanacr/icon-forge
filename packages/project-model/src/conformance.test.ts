import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalJson } from './canonical.js';
import { quantize } from './quantization.js';

describe('S-01 numeric conformance properties', () => {
  it('is idempotent across the supported coordinate range', () => {
    fc.assert(fc.property(
      fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }),
      value => {
        const once = quantize(value);
        expect(quantize(once)).toBe(once);
        expect(Math.abs(once - value)).toBeLessThanOrEqual(0.0005 + Number.EPSILON);
      },
    ), { numRuns: 2_000 });
  });

  it('serializes every finite double as a JSON number that round-trips', () => {
    fc.assert(fc.property(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      value => {
        const restored = JSON.parse(canonicalJson({ value })) as { value: number };
        expect(restored.value).toBe(value === 0 ? 0 : value);
      },
    ), { numRuns: 2_000 });
  });
});
