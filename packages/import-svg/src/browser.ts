import type { ImportLimits, SvgElement } from './xml-reader.js';

type WorkerReply = { ok: true; ast: SvgElement } | { ok: false; error: string };

/** One parse per module worker, with a hard upper timeout and cleanup on every result. */
export function parseSvgInWorker(source: string,
  options: { timeoutMs?: number; limits?: Partial<ImportLimits> } = {}): Promise<SvgElement> {
  const requestedTimeout = options.timeoutMs ?? 2_000;
  if (!Number.isFinite(requestedTimeout) || requestedTimeout <= 0) {
    return Promise.reject(new TypeError('import.timeout-invalid'));
  }
  return new Promise<SvgElement>((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      action();
    };
    const timer = setTimeout(() => finish(() => reject(new TypeError('import.timeout'))),
      Math.min(requestedTimeout, 2_000));
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      finish(() => reply?.ok ? resolve(reply.ast) : reject(new TypeError(reply?.error ?? 'import.worker-error')));
    };
    worker.onerror = () => finish(() => reject(new TypeError('import.worker-error')));
    worker.onmessageerror = () => finish(() => reject(new TypeError('import.worker-message-error')));
    try { worker.postMessage({ source, limits: options.limits }); }
    catch (error) { finish(() => reject(error)); }
  });
}
