export const QUANTUM = 0.001;

/** Round the shortest decimal representation of a finite number, ties to even. */
export function quantize(value: number, places = 3): number {
  if (!Number.isFinite(value) || !Number.isInteger(places) || places < 0 || places > 12) {
    throw new RangeError('Invalid quantization input');
  }
  const source = Math.abs(value).toString();
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(source);
  if (!match) throw new RangeError('Invalid decimal');
  const fractional = match[2] ?? '';
  const digits = BigInt(`${match[1]}${fractional}`);
  const exponent = Number(match[3] ?? 0) - fractional.length + places;
  let scaled: bigint;
  if (exponent >= 0) {
    scaled = digits * 10n ** BigInt(exponent);
  } else {
    const divisor = 10n ** BigInt(-exponent);
    const quotient = digits / divisor;
    const remainder = digits % divisor;
    scaled = quotient + (remainder * 2n > divisor || (remainder * 2n === divisor && quotient % 2n !== 0n) ? 1n : 0n);
  }
  const result = (value < 0 ? -Number(scaled) : Number(scaled)) / 10 ** places;
  return result === 0 ? 0 : result;
}

import type { MatrixV1 } from './types.js';

export function quantizeMatrix(matrix: MatrixV1): MatrixV1 {
  return [
    quantize(matrix[0], 6), quantize(matrix[1], 6),
    quantize(matrix[2], 6), quantize(matrix[3], 6),
    quantize(matrix[4]), quantize(matrix[5]),
  ];
}
