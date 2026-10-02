export function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError('Non-finite number');
  if (value === 0) return '0';
  const source = value.toString();
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(source);
  if (!match) throw new TypeError('Invalid number');
  const fraction = match[3] ?? '';
  const digits = `${match[2]}${fraction}`;
  const decimalAt = match[2]!.length + Number(match[4] ?? 0);
  if (decimalAt <= 0) return `${match[1]}0.${'0'.repeat(-decimalAt)}${digits}`;
  if (decimalAt >= digits.length) return `${match[1]}${digits}${'0'.repeat(decimalAt - digits.length)}`;
  return `${match[1]}${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
}

export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  function write(input: unknown): string {
    if (input === null) return 'null';
    if (typeof input === 'string' || typeof input === 'boolean') return JSON.stringify(input);
    if (typeof input === 'number') return canonicalNumber(input);
    if (typeof input !== 'object') throw new TypeError('Unsupported JSON value');
    if (seen.has(input)) throw new TypeError('Cyclic JSON value');
    seen.add(input);
    const result = Array.isArray(input)
      ? `[${input.map(write).join(',')}]`
      : `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${write((input as Record<string, unknown>)[key])}`).join(',')}}`;
    seen.delete(input);
    return result;
  }
  return write(value);
}
