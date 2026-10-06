/** Fail before opening storage when a required editing capability is unavailable. */
export async function assertBrowserCapabilities(): Promise<void> {
  const missing: string[] = [];
  if (typeof indexedDB === 'undefined') missing.push('IndexedDB');
  if (typeof navigator.locks?.request !== 'function') missing.push('Web Locks');
  if (typeof BroadcastChannel !== 'function') missing.push('BroadcastChannel');
  if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') missing.push('WebAssembly');
  if (typeof Worker !== 'function') missing.push('Web Workers');
  if (missing.length) throw new Error(`This browser is missing required editing features: ${missing.join(', ')}.`);

  await new Promise<void>((resolve, reject) => {
    let worker: Worker;
    try {
      const url = new URL('/capability-worker.js', location.origin);
      const trustedTypes = (globalThis as typeof globalThis & { trustedTypes?: {
        createPolicy(name: string, rules: { createScriptURL(value: string): string }): {
          createScriptURL(value: string): unknown } } }).trustedTypes;
      const source = trustedTypes?.createPolicy('iconforge-preview', {
        createScriptURL(value) {
          if (value !== url.href || url.origin !== location.origin) throw new TypeError('worker.url.invalid');
          return value;
        },
      }).createScriptURL(url.href) ?? url.href;
      worker = new Worker(source as string, { type: 'module' });
    }
    catch { reject(new Error('This browser cannot start module Web Workers.')); return; }
    let settled = false;
    const timer = setTimeout(() => finish(false), 2_000);
    const finish = (ready: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      if (ready) resolve();
      else reject(new Error('This browser cannot start module Web Workers.'));
    };
    worker.onmessage = event => finish(event.data === 'ready');
    worker.onerror = () => finish(false);
    worker.onmessageerror = () => finish(false);
  });
}
