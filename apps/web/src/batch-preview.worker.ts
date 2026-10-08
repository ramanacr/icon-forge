import { applyProjectCommand, type ProjectCommand, type StructuralPatch } from '@iconforge/commands';
import { serializeIconSvg } from '@iconforge/export-svg';
import type { ProjectV1 } from '@iconforge/project-model';

type BatchCommand = Extract<ProjectCommand, { type: 'set.applyStyle' }>;
type Request = { project: ProjectV1; command: BatchCommand };
type IconPreview = { iconId: string; beforeSvg: string; afterSvg: string };
type Inapplicable = { iconId: string; reason: string };
type Reply = { ok: true; patches: StructuralPatch[]; icons: IconPreview[];
  iconIds: string[]; notApplicable: Inapplicable[]; computeMs: number }
  | { ok: false; error: string };

const reasons: Record<string, string> = {
  'set.applyStyle.variants-unsupported': 'Variants need a separate style operation',
  'set.applyStyle.instance-unsupported': 'Component instances need a separate style operation',
  'set.applyStyle.locked': 'A locked shape needs a different stroke policy',
};

self.addEventListener('message', (event: MessageEvent<Request>) => {
  const start = performance.now();
  let reply: Reply;
  try {
    const { project, command } = event.data;
    if (command?.type !== 'set.applyStyle' || command.dryRun !== true) {
      throw new TypeError('batch.preview.invalid-command');
    }
    let iconIds = command.payload.iconIds;
    const notApplicable: Inapplicable[] = [];
    let applied: ReturnType<typeof applyProjectCommand> | null;
    try { applied = applyProjectCommand(project, command); }
    catch (error) {
      if (!(error instanceof Error) || !(error.message in reasons)) throw error;
      iconIds = [];
      for (const iconId of command.payload.iconIds) {
        try {
          applyProjectCommand(project, { ...command, payload: { ...command.payload, iconIds: [iconId] } });
          iconIds.push(iconId);
        } catch (candidateError) {
          if (!(candidateError instanceof Error) || !(candidateError.message in reasons)) throw candidateError;
          notApplicable.push({ iconId, reason: reasons[candidateError.message]! });
        }
      }
      applied = iconIds.length ? applyProjectCommand(project, { ...command,
        payload: { ...command.payload, iconIds } }) : null;
    }
    const changedIndices = [...new Set((applied?.patches ?? []).map(patch => Number(patch.path[1])))];
    const options = { precision: 3 as const, paintMode: 'resolved' as const,
      sizeAttrs: false, metadata: false, theme: 'light' as const };
    const icons = changedIndices.map(index => {
      const before = project.icons[index]!;
      const after = applied!.project.icons[index]!;
      return { iconId: before.id, beforeSvg: serializeIconSvg(project, before, options),
        afterSvg: serializeIconSvg(applied!.project, after, options) };
    });
    reply = { ok: true, patches: applied?.patches ?? [], icons, iconIds,
      notApplicable, computeMs: performance.now() - start };
  } catch (error) {
    reply = { ok: false, error: error instanceof Error ? error.message : 'batch.preview.failed' };
  }
  self.postMessage(reply);
});
