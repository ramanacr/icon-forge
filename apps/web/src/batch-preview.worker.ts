import { applyProjectCommand, type ProjectCommand, type StructuralPatch } from '@iconforge/commands';
import type { ProjectV1 } from '@iconforge/project-model';

type BatchCommand = Extract<ProjectCommand, { type: 'set.applyStyle' }>;
type Request = { project: ProjectV1; command: BatchCommand };
type Reply = { ok: true; patches: StructuralPatch[]; computeMs: number }
  | { ok: false; error: string };

self.addEventListener('message', (event: MessageEvent<Request>) => {
  const start = performance.now();
  let reply: Reply;
  try {
    const { project, command } = event.data;
    if (command?.type !== 'set.applyStyle' || command.dryRun !== true) {
      throw new TypeError('batch.preview.invalid-command');
    }
    reply = { ok: true, patches: applyProjectCommand(project, command).patches,
      computeMs: performance.now() - start };
  } catch (error) {
    reply = { ok: false, error: error instanceof Error ? error.message : 'batch.preview.failed' };
  }
  self.postMessage(reply);
});
