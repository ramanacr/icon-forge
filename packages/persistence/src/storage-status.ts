export type StorageDurability = 'persistent' | 'best-effort' | 'unsupported';

export interface PersistenceCapability {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

/** Read durability on reopen without prompting for permission again. */
export async function readStorageDurability(
  storage: PersistenceCapability | undefined = globalThis.navigator?.storage,
): Promise<StorageDurability> {
  if (!storage || typeof storage.persisted !== 'function') return 'unsupported';
  try { return await storage.persisted() ? 'persistent' : 'best-effort'; }
  catch { return 'best-effort'; }
}

/** Called on first project creation so the UI can explain the durability of its browser copy. */
export async function requestPersistentStorage(
  storage: PersistenceCapability | undefined = globalThis.navigator?.storage,
): Promise<StorageDurability> {
  if (!storage || typeof storage.persisted !== 'function' || typeof storage.persist !== 'function') return 'unsupported';
  try {
    if (await storage.persisted() || await storage.persist()) return 'persistent';
  } catch { /* Browsers may reject in private or constrained contexts. */ }
  return 'best-effort';
}
