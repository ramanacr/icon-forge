import { applyProjectCommand, type ProjectCommand, type StructuralPatch } from '@iconforge/commands';
import { serializeIconSvg } from '@iconforge/export-svg';
import type { ProjectV1 } from '@iconforge/project-model';

type BatchCommand = Extract<ProjectCommand, { type: 'set.applyStyle' }>;
type Request = { project: ProjectV1; command: BatchCommand };
type IconPreview = { iconId: string; beforeSvg: string; afterSvg: string };
type Reply = { ok: true; patches: StructuralPatch[]; icons: IconPreview[]; computeMs: number }
  | { ok: false; error: string };

self.addEventListener('message', (event: MessageEvent<Request>) => {
  const start = performance.now();
  let reply: Reply;
  try {
    const { project, command } = event.data;
    if (command?.type !== 'set.applyStyle' || command.dryRun !== true) {
      throw new TypeError('batch.preview.invalid-command');
    }
    const applied = applyProjectCommand(project, command);
    const changedIndices = [...new Set(applied.patches.map(patch => Number(patch.path[1])))];
    const options = { precision: 3 as const, paintMode: 'resolved' as const,
      sizeAttrs: false, metadata: false, theme: 'light' as const };
    const icons = changedIndices.map(index => {
      const before = project.icons[index]!;
      const after = applied.project.icons[index]!;
      return { iconId: before.id, beforeSvg: serializeIconSvg(project, before, options),
        afterSvg: serializeIconSvg(applied.project, after, options) };
    });
    reply = { ok: true, patches: applied.patches, icons, computeMs: performance.now() - start };
  } catch (error) {
    reply = { ok: false, error: error instanceof Error ? error.message : 'batch.preview.failed' };
  }
  self.postMessage(reply);
});
