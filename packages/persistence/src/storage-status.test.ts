import { describe, expect, it } from 'vitest';
import { requestPersistentStorage } from './storage-status.js';

describe('persistent browser storage', () => {
  it('requests persistence when the browser has not granted it', async () => {
    let requests = 0;
    const status = await requestPersistentStorage({
      persisted: async () => false,
      persist: async () => { requests++; return true; },
    });
    expect(status).toBe('persistent');
    expect(requests).toBe(1);
  });

  it('does not prompt again when already persistent', async () => {
    const status = await requestPersistentStorage({
      persisted: async () => true,
      persist: async () => { throw new Error('unexpected request'); },
    });
    expect(status).toBe('persistent');
  });

  it('reports best effort when denied or browser API rejects', async () => {
    expect(await requestPersistentStorage({ persisted: async () => false, persist: async () => false })).toBe('best-effort');
    expect(await requestPersistentStorage({ persisted: async () => { throw new Error('blocked'); }, persist: async () => true })).toBe('best-effort');
  });

  it('reports unsupported browsers', async () => {
    expect(await requestPersistentStorage(undefined)).toBe('unsupported');
  });
});
