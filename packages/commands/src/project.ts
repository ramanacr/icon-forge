import { assertProject, type DesignSystemV1, type IconV1, type ProjectV1, type UUID } from '@iconforge/project-model';

interface EnvelopeBase {
  commandVersion: '1.0';
  commandId: UUID;
  projectId: UUID;
  expectedRevision?: number;
  dryRun?: boolean;
  confirmsDryRun?: UUID;
  issuedAt: string;
  actor: { kind: 'user' | 'cli' | 'mcp' | 'webmcp' | 'ai-proposal'; id?: string };
}

export type ProjectCommand = EnvelopeBase & (
  | { type: 'project.create'; payload: { id: UUID; name: string; designSystem?: DesignSystemV1 } }
  | { type: 'project.rename'; payload: { name: string } }
  | { type: 'icon.add'; payload: { icon: IconV1 } }
  | { type: 'icon.rename'; payload: { iconId: UUID; name: string } }
  | { type: 'icon.remove'; payload: { iconId: UUID } }
);

export type HistoryCommand = EnvelopeBase & (
  | { type: 'history.undo'; payload: Record<string, never> }
  | { type: 'history.redo'; payload: Record<string, never> }
);

export type CommandEnvelopeV1 = ProjectCommand | HistoryCommand;

export type StructuralPatch =
  | { op: 'replace'; path: string[]; before: unknown; after: unknown }
  | { op: 'insert' | 'remove'; path: string[]; value: unknown };

export interface HandlerResult {
  project: ProjectV1;
  patches: StructuralPatch[];
  inversePatches: StructuralPatch[];
  result: {
    commandId: UUID;
    status: 'applied' | 'dry-run';
    revision: number;
    changedIds: UUID[];
    patchSummary: { added: number; updated: number; removed: number; iconsAffected: UUID[] };
    diagnostics: [];
  };
}

const DEFAULT_DESIGN_SYSTEM: DesignSystemV1 = {
  grid: { width: 24, height: 24 },
  safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
  style: 'outline',
  stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 },
  cornerRadius: 2,
  defaultPaintToken: 'currentColor',
  naming: { pattern: 'kebab', reserved: [] },
  severities: {},
};

function validName(name: string): void {
  if (name.length < 1 || name.length > 120) throw new TypeError('project.name.invalid');
}

export function applyProjectCommand(project: ProjectV1 | null, command: ProjectCommand): HandlerResult {
  if (command.commandVersion !== '1.0') throw new TypeError('command.version.unsupported');
  if (command.type === 'project.create') {
    if (project !== null || command.projectId !== command.payload.id) throw new TypeError('project.create.invalid-target');
    validName(command.payload.name);
    const next: ProjectV1 = assertProject({
      schemaVersion: '1.0', id: command.payload.id, name: command.payload.name, revision: 1,
      designSystem: command.payload.designSystem ?? DEFAULT_DESIGN_SYSTEM,
      tokens: [], components: [], icons: [], exportProfiles: [], provenance: [],
    });
    return {
      project: next,
      patches: [{ op: 'replace', path: [], before: null, after: next }],
      inversePatches: [{ op: 'replace', path: [], before: next, after: null }],
      result: { commandId: command.commandId, status: command.dryRun ? 'dry-run' : 'applied', revision: 1,
        changedIds: [next.id], patchSummary: { added: 1, updated: 0, removed: 0, iconsAffected: [] }, diagnostics: [] },
    };
  }
  if (project === null || command.projectId !== project.id) throw new TypeError('project.not-found');
  if (command.expectedRevision !== undefined && command.expectedRevision !== project.revision) {
    throw new TypeError('revision.conflict');
  }
  if (command.type === 'project.rename') {
    validName(command.payload.name);
    const next = assertProject({ ...project, name: command.payload.name, revision: project.revision + 1 });
    return {
      project: next,
      patches: [{ op: 'replace', path: ['name'], before: project.name, after: next.name }],
      inversePatches: [{ op: 'replace', path: ['name'], before: next.name, after: project.name }],
      result: { commandId: command.commandId, status: command.dryRun ? 'dry-run' : 'applied', revision: next.revision,
        changedIds: [project.id], patchSummary: { added: 0, updated: 1, removed: 0, iconsAffected: [] }, diagnostics: [] },
    };
  }
  let icons: IconV1[];
  let count: { added: number; updated: number; removed: number };
  let iconId: UUID;
  let patches: StructuralPatch[];
  let inversePatches: StructuralPatch[];
  if (command.type === 'icon.add') {
    iconId = command.payload.icon.id;
    const path = ['icons', String(project.icons.length)];
    icons = [...project.icons, structuredClone(command.payload.icon)];
    count = { added: 1, updated: 0, removed: 0 };
    patches = [{ op: 'insert', path, value: command.payload.icon }];
    inversePatches = [{ op: 'remove', path, value: command.payload.icon }];
  } else {
    iconId = command.payload.iconId;
    const index = project.icons.findIndex(icon => icon.id === iconId);
    if (index < 0) throw new TypeError('icon.not-found');
    icons = structuredClone(project.icons);
    if (command.type === 'icon.remove') {
      const removed = icons[index]!;
      icons.splice(index, 1);
      count = { added: 0, updated: 0, removed: 1 };
      const path = ['icons', String(index)];
      patches = [{ op: 'remove', path, value: removed }];
      inversePatches = [{ op: 'insert', path, value: removed }];
    } else {
      const before = icons[index]!.name;
      icons[index] = { ...icons[index]!, name: command.payload.name };
      count = { added: 0, updated: 1, removed: 0 };
      const path = ['icons', String(index), 'name'];
      patches = [{ op: 'replace', path, before, after: command.payload.name }];
      inversePatches = [{ op: 'replace', path, before: command.payload.name, after: before }];
    }
  }
  const next = assertProject({ ...project, icons, revision: project.revision + 1 });
  return {
    project: next,
    patches,
    inversePatches,
    result: { commandId: command.commandId, status: command.dryRun ? 'dry-run' : 'applied', revision: next.revision,
      changedIds: [iconId], patchSummary: { ...count, iconsAffected: [iconId] }, diagnostics: [] },
  };
}
