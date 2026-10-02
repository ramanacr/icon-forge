import { describe, expect, it } from 'vitest';
import { quantize, quantizeMatrix } from './quantization.js';

describe('quantize', () => {
  it('uses half-even rounding at positive and negative ties', () => {
    expect(quantize(1.2345)).toBe(1.234);
    expect(quantize(1.2355)).toBe(1.236);
    expect(quantize(-1.2345)).toBe(-1.234);
    expect(quantize(-1.2355)).toBe(-1.236);
  });

  it('normalizes negative zero and rejects non-finite numbers', () => {
    expect(Object.is(quantize(-0.0001), -0)).toBe(false);
    expect(() => quantize(Number.NaN)).toThrow();
    expect(() => quantize(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('quantizes matrix linear terms more finely than translations', () => {
    expect(quantizeMatrix([1.0000006, 0, 0, 1, 2.0006, -2.0006]))
      .toEqual([1.000001, 0, 0, 1, 2.001, -2.001]);
  });
});
