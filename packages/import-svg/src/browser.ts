import type { ImportLimits, SvgElement } from './xml-reader.js';
import type { IconV1, ProvenanceRecordV1 } from '@iconforge/project-model';
import type { CanonicalSvgImport } from './canonicalize.js';

type WorkerReply<T> = { ok: true; result: T } | { ok: false; error: string };

function runWorker<T>(request: unknown, timeoutMs = 2_000): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new TypeError('import.timeout-invalid'));
  }
  return new Promise<T>((resolve, reject) => {
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
      Math.min(timeoutMs, 2_000));
    worker.onmessage = (event: MessageEvent<WorkerReply<T>>) => {
      const reply = event.data;
      finish(() => reply?.ok ? resolve(reply.result) : reject(new TypeError(reply?.error ?? 'import.worker-error')));
    };
    worker.onerror = () => finish(() => reject(new TypeError('import.worker-error')));
    worker.onmessageerror = () => finish(() => reject(new TypeError('import.worker-message-error')));
    try { worker.postMessage(request); }
    catch (error) { finish(() => reject(error)); }
  });
}

/** One parse per module worker, with a hard upper timeout and cleanup on every result. */
export function parseSvgInWorker(source: string,
  options: { timeoutMs?: number; limits?: Partial<ImportLimits> } = {}): Promise<SvgElement> {
  if (typeof source !== 'string') return Promise.reject(new TypeError('import.source-invalid'));
  if (source.length > 2 * 1024 * 1024) return Promise.reject(new TypeError('import.source-limit'));
  return runWorker<SvgElement>({ kind: 'parse', source, limits: options.limits }, options.timeoutMs);
}

export interface PreparedSvgImport extends CanonicalSvgImport {
  provenance: ProvenanceRecordV1;
  originalSvg: Uint8Array;
}

/** Keep caller-owned bytes intact so appendImport can atomically persist them with the command. */
export async function prepareSvgImportInWorker(originalSvg: Uint8Array,
  options: { iconId: string; provenanceId: string; name: string; timeoutMs?: number }): Promise<PreparedSvgImport> {
  if (!(originalSvg instanceof Uint8Array)) throw new TypeError('import.source-invalid');
  if (originalSvg.length > 2 * 1024 * 1024) throw new TypeError('import.source-limit');
  const result = await runWorker<{ icon: IconV1; provenance: ProvenanceRecordV1; diagnostics: CanonicalSvgImport['diagnostics'] }>(
    { kind: 'prepare', bytes: new Uint8Array(originalSvg),
      iconId: options.iconId, provenanceId: options.provenanceId, name: options.name }, options.timeoutMs);
  return { ...result, originalSvg: new Uint8Array(originalSvg) };
}
