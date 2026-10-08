import type { ProjectCommand, StructuralPatch } from '@iconforge/commands';
import type { ProjectV1 } from '@iconforge/project-model';

type BatchCommand = Extract<ProjectCommand, { type: 'set.applyStyle' }>;
type IconPreview = { iconId: string; beforeSvg: string; afterSvg: string };
type Inapplicable = { iconId: string; reason: string };
type Reply = { ok: true; patches: StructuralPatch[]; icons: IconPreview[];
  iconIds: string[]; notApplicable: Inapplicable[]; computeMs: number }
  | { ok: false; error: string };

/** One isolated dry-run per worker, with bounded lifetime and no document mutation. */
export function previewBatchInWorker(project: ProjectV1, command: BatchCommand):
  Promise<{ patches: StructuralPatch[]; icons: IconPreview[];
    iconIds: string[]; notApplicable: Inapplicable[]; computeMs: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./batch-preview.worker.js', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      action();
    };
    const timer = setTimeout(() => finish(() => reject(new TypeError('batch.preview.timeout'))), 2_000);
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      finish(() => reply?.ok ? resolve({ patches: reply.patches, icons: reply.icons,
        iconIds: reply.iconIds, notApplicable: reply.notApplicable, computeMs: reply.computeMs })
        : reject(new TypeError(reply?.error ?? 'batch.preview.worker-error')));
    };
    worker.onerror = () => finish(() => reject(new TypeError('batch.preview.worker-error')));
    worker.onmessageerror = () => finish(() => reject(new TypeError('batch.preview.worker-message-error')));
    try { worker.postMessage({ project, command }); }
    catch (error) { finish(() => reject(error)); }
  });
}
