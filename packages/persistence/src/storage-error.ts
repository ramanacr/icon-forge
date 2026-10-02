export class ProjectStorageError extends Error {
  constructor(readonly code: 'quota-exceeded', cause: unknown) {
    super(code, { cause });
    this.name = 'ProjectStorageError';
  }
}

function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('name' in error && error.name === 'QuotaExceededError') return true;
  if ('inner' in error && error.inner !== error) return isQuotaError(error.inner);
  if ('cause' in error && error.cause !== error) return isQuotaError(error.cause);
  return false;
}

export function asProjectStorageError(error: unknown): Error {
  if (isQuotaError(error)) return new ProjectStorageError('quota-exceeded', error);
  return error instanceof Error ? error : new Error(String(error));
}
