export type StorageDurability = 'persistent' | 'best-effort' | 'unsupported';

export interface PersistenceCapability {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
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
