import { describe, expect, it } from 'vitest';
import { asProjectStorageError, ProjectStorageError } from './storage-error.js';

describe('storage errors', () => {
  it('converts quota failures into a recoverable storage code', () => {
    const native = new DOMException('quota reached', 'QuotaExceededError');
    const mapped = asProjectStorageError(native);
    expect(mapped).toBeInstanceOf(ProjectStorageError);
    expect(mapped).toMatchObject({ code: 'quota-exceeded' });
    expect(mapped.cause).toBe(native);
  });

  it('finds quota failures wrapped by Dexie', () => {
    const wrapped = { name: 'DatabaseError', inner: { name: 'QuotaExceededError' } };
    expect(asProjectStorageError(wrapped)).toMatchObject({ code: 'quota-exceeded' });
  });

  it('preserves non-quota errors for the caller', () => {
    const error = new Error('write failed');
    expect(asProjectStorageError(error)).toBe(error);
  });
});
