import { assertProject, quantizeMatrix, type ColorTokenV1, type ComponentV1, type DesignSystemV1, type ExportProfileV1, type IconV1, type MatrixV1, type PaintV1, type ProjectV1, type StrokeV1,
  type SceneNodeV1, type UUID, type VariantV1 } from '@iconforge/project-model';
import { duplicateIcon } from './duplicate.js';
import { findNodePath, nodeArrayAt, removalOrder } from './scene-path.js';

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
  | { type: 'project.updateDesignSystem'; payload: { patch: Partial<DesignSystemV1> } }
  | { type: 'token.upsert'; payload: { token: ColorTokenV1 } }
  | { type: 'token.remove'; payload: { name: string } }
  | { type: 'icon.add'; payload: { icon: IconV1 } }
  | { type: 'icon.rename'; payload: { iconId: UUID; name: string } }
  | { type: 'icon.updateMetadata'; payload: { iconId: UUID; patch: IconMetadataPatch } }
  | { type: 'icon.remove'; payload: { iconId: UUID } }
  | { type: 'icon.duplicate'; payload: { iconId: UUID; newIconId: UUID; idMap: Record<UUID, UUID> } }
  | { type: 'variant.add'; payload: { iconId: UUID; variant: VariantV1 } }
  | { type: 'variant.update'; payload: { iconId: UUID; variant: VariantV1 } }
  | { type: 'variant.remove'; payload: { iconId: UUID; variantId: UUID } }
  | { type: 'component.add'; payload: { component: ComponentV1 } }
  | { type: 'component.update'; payload: { component: ComponentV1 } }
  | { type: 'component.remove'; payload: { componentId: UUID } }
  | { type: 'node.add'; payload: { iconId: UUID; parentId?: UUID; index: number; node: SceneNodeV1 } }
  | { type: 'node.update'; payload: { iconId: UUID; nodeId: UUID; ops: NodeUpdateOp[] } }
  | { type: 'node.remove'; payload: { iconId: UUID; nodeIds: UUID[] } }
  | { type: 'node.reorder'; payload: { iconId: UUID; nodeId: UUID; parentId?: UUID; index: number } }
  | { type: 'node.group'; payload: { iconId: UUID; nodeIds: UUID[]; groupId: UUID; index: number } }
  | { type: 'node.ungroup'; payload: { iconId: UUID; groupId: UUID } }
  | { type: 'selection.transform'; payload: { iconId: UUID; nodeIds: UUID[]; matrix: MatrixV1 } }
  | { type: 'exportProfile.upsert'; payload: { profile: ExportProfileV1 } }
  | { type: 'exportProfile.remove'; payload: { profileId: UUID } }
);

/** Explicit node field operations; callers cannot merge arbitrary scene data. */
export type NodeUpdateOp =
  | { op: 'setFill'; fill: PaintV1 | null }
  | { op: 'setStroke'; stroke: StrokeV1 | null };

export type IconMetadataPatch = Partial<Pick<IconV1, 'aliases' | 'tags' | 'accessibility'>> & {
  /** Explicit null removes the optional font mapping. */
  font?: IconV1['font'] | null;
};

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

function tokenIsUsed(project: ProjectV1, name: string): boolean {
  if (project.designSystem.defaultPaintToken === name) return true;
  const paintUses = (paint: PaintV1 | null | undefined): boolean => paint?.kind === 'token' && paint.token === name;
  const nodeUses = (node: SceneNodeV1): boolean =>
    ('fill' in node && paintUses(node.fill)) || ('stroke' in node && node.stroke !== undefined && paintUses(node.stroke.paint))
    || (node.type === 'group' && node.children.some(nodeUses));
  return project.components.some(component => component.nodes.some(nodeUses))
    || project.icons.some(icon => icon.nodes.some(nodeUses) || icon.variants.some(variant => variant.overrides.some(override =>
      override.op === 'replaceNode' ? nodeUses(override.node)
        : override.op === 'setFill' ? paintUses(override.fill)
          : override.op === 'setStroke' ? override.stroke !== null && paintUses(override.stroke.paint) : false)));
}

function componentIsUsed(project: ProjectV1, id: UUID): boolean {
  const uses = (node: SceneNodeV1): boolean => node.type === 'instance' && node.componentId === id
    || node.type === 'group' && node.children.some(uses);
  return project.components.some(component => component.nodes.some(uses))
    || project.icons.some(icon => icon.nodes.some(uses) || icon.variants.some(variant => variant.overrides.some(override =>
      override.op === 'replaceNode' && uses(override.node))));
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
  if (command.type === 'project.updateDesignSystem') {
    const designSystem = { ...project.designSystem, ...structuredClone(command.payload.patch) };
    const next = assertProject({ ...project, designSystem, revision: project.revision + 1 });
    return { project: next,
      patches: [{ op: 'replace', path: ['designSystem'], before: project.designSystem, after: next.designSystem }],
      inversePatches: [{ op: 'replace', path: ['designSystem'], before: next.designSystem, after: project.designSystem }],
      result: { commandId: command.commandId, status: command.dryRun ? 'dry-run' : 'applied', revision: next.revision,
        changedIds: [project.id], patchSummary: { added: 0, updated: 1, removed: 0, iconsAffected: [] }, diagnostics: [] } };
  }
  if (command.type === 'token.upsert' || command.type === 'token.remove') {
    const name = command.type === 'token.upsert' ? command.payload.token.name : command.payload.name;
    const index = project.tokens.findIndex(token => token.name === name);
    if (command.type === 'token.remove' && index < 0) throw new TypeError('token.not-found');
    if (command.type === 'token.remove' && tokenIsUsed(project, name)) throw new TypeError('token.in-use');
    const tokens = structuredClone(project.tokens);
    let patch: StructuralPatch;
    let inversePatch: StructuralPatch;
    let count: { added: number; updated: number; removed: number };
    if (command.type === 'token.remove') {
      const removed = tokens.splice(index, 1)[0]!;
      patch = { op: 'remove', path: ['tokens', String(index)], value: removed };
      inversePatch = { op: 'insert', path: ['tokens', String(index)], value: removed };
      count = { added: 0, updated: 0, removed: 1 };
    } else if (index < 0) {
      tokens.push(structuredClone(command.payload.token));
      patch = { op: 'insert', path: ['tokens', String(tokens.length - 1)], value: command.payload.token };
      inversePatch = { op: 'remove', path: patch.path, value: command.payload.token };
      count = { added: 1, updated: 0, removed: 0 };
    } else {
      const before = tokens[index]!;
      tokens[index] = structuredClone(command.payload.token);
      patch = { op: 'replace', path: ['tokens', String(index)], before, after: command.payload.token };
      inversePatch = { op: 'replace', path: patch.path, before: command.payload.token, after: before };
      count = { added: 0, updated: 1, removed: 0 };
    }
    const next = assertProject({ ...project, tokens, revision: project.revision + 1 });
    return { project: next, patches: [patch], inversePatches: [inversePatch],
      result: { commandId: command.commandId, status: command.dryRun ? 'dry-run' : 'applied', revision: next.revision,
        changedIds: [project.id], patchSummary: { ...count, iconsAffected: [] }, diagnostics: [] } };
  }
  if (command.type === 'exportProfile.upsert' || command.type === 'exportProfile.remove') {
    const profileId = command.type === 'exportProfile.upsert' ? command.payload.profile.id : command.payload.profileId;
    const index = project.exportProfiles.findIndex(profile => profile.id === profileId);
    if (command.type === 'exportProfile.remove' && index < 0) throw new TypeError('export-profile.not-found');
    const profiles = structuredClone(project.exportProfiles);
    let patch: StructuralPatch;
    let inversePatch: StructuralPatch;
    let count: { added: number; updated: number; removed: number };
    if (command.type === 'exportProfile.remove') {
      const removed = profiles.splice(index, 1)[0]!;
      patch = { op: 'remove', path: ['exportProfiles', String(index)], value: removed };
      inversePatch = { op: 'insert', path: patch.path, value: removed };
      count = { added: 0, updated: 0, removed: 1 };
    } else if (index < 0) {
      const profile = structuredClone(command.payload.profile);
      profiles.push(profile);
      patch = { op: 'insert', path: ['exportProfiles', String(profiles.length - 1)], value: profile };
      inversePatch = { op: 'remove', path: patch.path, value: profile };
      count = { added: 1, updated: 0, removed: 0 };
    } else {
      const before = profiles[index]!;
      const after = structuredClone(command.payload.profile);
      profiles[index] = after;
      patch = { op: 'replace', path: ['exportProfiles', String(index)], before, after };
      inversePatch = { op: 'replace', path: patch.path, before: after, after: before };
      count = { added: 0, updated: 1, removed: 0 };
    }
    const next = assertProject({ ...project, exportProfiles: profiles, revision: project.revision + 1 });
    return { project: next, patches: [patch], inversePatches: [inversePatch],
      result: { commandId: command.commandId, status: command.dryRun ? 'dry-run' : 'applied', revision: next.revision,
        changedIds: [profileId], patchSummary: { ...count, iconsAffected: [] }, diagnostics: [] } };
  }
  if (command.type === 'component.add' || command.type === 'component.update' || command.type === 'component.remove') {
    const componentId = command.type === 'component.remove' ? command.payload.componentId : command.payload.component.id;
    const index = project.components.findIndex(component => component.id === componentId);
    if (command.type === 'component.add' && index >= 0) throw new TypeError('component.already-exists');
    if (command.type !== 'component.add' && index < 0) throw new TypeError('component.not-found');
    if (command.type === 'component.remove' && componentIsUsed(project, componentId)) throw new TypeError('component.in-use');
    const components = structuredClone(project.components);
    let patch: StructuralPatch;
    let inversePatch: StructuralPatch;
    let count: { added: number; updated: number; removed: number };
    if (command.type === 'component.add') {
      const component = structuredClone(command.payload.component);
      const path = ['components', String(components.length)];
      components.push(component);
      patch = { op: 'insert', path, value: component };
      inversePatch = { op: 'remove', path, value: component };
      count = { added: 1, updated: 0, removed: 0 };
    } else if (command.type === 'component.remove') {
      const removed = components.splice(index, 1)[0]!;
      const path = ['components', String(index)];
      patch = { op: 'remove', path, value: removed };
      inversePatch = { op: 'insert', path, value: removed };
      count = { added: 0, updated: 0, removed: 1 };
    } else {
      const before = components[index]!;
      const after = structuredClone(command.payload.component);
      components[index] = after;
      const path = ['components', String(index)];
      patch = { op: 'replace', path, before, after };
      inversePatch = { op: 'replace', path, before: after, after: before };
      count = { added: 0, updated: 1, removed: 0 };
    }
    const next = assertProject({ ...project, components, revision: project.revision + 1 });
    return { project: next, patches: [patch], inversePatches: [inversePatch],
      result: { commandId: command.commandId, status: command.dryRun ? 'dry-run' : 'applied', revision: next.revision,
        changedIds: [componentId], patchSummary: { ...count, iconsAffected: [] }, diagnostics: [] } };
  }
  if (command.type === 'node.add' || command.type === 'node.update' || command.type === 'node.remove'
    || command.type === 'node.reorder' || command.type === 'node.group'
    || command.type === 'node.ungroup' || command.type === 'selection.transform') {
    const iconIndex = project.icons.findIndex(icon => icon.id === command.payload.iconId);
    if (iconIndex < 0) throw new TypeError('icon.not-found');
    const icon = project.icons[iconIndex]!;
    const icons = structuredClone(project.icons);
    const copy = icons[iconIndex]!;
    let patches: StructuralPatch[];
    let inversePatches: StructuralPatch[];
    let count: { added: number; updated: number; removed: number };
    let changedIds: UUID[];
    if (command.type === 'node.add') {
      const parentPath = command.payload.parentId === undefined ? null : findNodePath(icon, command.payload.parentId);
      if (command.payload.parentId !== undefined && parentPath === null) throw new TypeError('node.parent.not-found');
      const containerPath = parentPath === null ? ['nodes'] : [...parentPath, 'children'];
      const container = nodeArrayAt(copy, containerPath);
      const index = command.payload.index;
      if (!Number.isSafeInteger(index) || index < 0 || index > container.length) throw new TypeError('node.index.invalid');
      const node = structuredClone(command.payload.node);
      container.splice(index, 0, node);
      const path = ['icons', String(iconIndex), ...containerPath, String(index)];
      patches = [{ op: 'insert', path, value: node }];
      inversePatches = [{ op: 'remove', path, value: node }];
      count = { added: 1, updated: 0, removed: 0 };
      changedIds = [icon.id, node.id];
    } else if (command.type === 'node.update') {
      const path = findNodePath(icon, command.payload.nodeId);
      if (!path) throw new TypeError('node.not-found');
      const container = nodeArrayAt(copy, path.slice(0, -1));
      const index = Number(path.at(-1));
      const before = container[index]!;
      if (before.locked) throw new TypeError('node.update.locked');
      const ops = command.payload.ops;
      if (!ops.length) throw new TypeError('node.update.empty');
      if (new Set(ops.map(op => op.op)).size !== ops.length) throw new TypeError('node.update.duplicate-op');
      const after = structuredClone(before) as unknown as Record<string, unknown>;
      for (const op of ops) {
        if (op.op === 'setFill') {
          if (before.type !== 'rect' && before.type !== 'ellipse'
            && before.type !== 'path' && before.type !== 'polyline') {
            throw new TypeError('node.update.fill.unsupported');
          }
          if (op.fill === null) delete after.fill;
          else after.fill = structuredClone(op.fill);
        } else {
          if (before.type !== 'line' && before.type !== 'rect' && before.type !== 'ellipse'
            && before.type !== 'path' && before.type !== 'polyline') {
            throw new TypeError('node.update.stroke.unsupported');
          }
          if (op.stroke === null) {
            if (before.type === 'line') throw new TypeError('node.update.stroke.required');
            delete after.stroke;
          } else after.stroke = structuredClone(op.stroke);
        }
      }
      container[index] = after as unknown as SceneNodeV1;
      const patchPath = ['icons', String(iconIndex), ...path];
      patches = [{ op: 'replace', path: patchPath, before, after }];
      inversePatches = [{ op: 'replace', path: patchPath, before: after, after: before }];
      count = { added: 0, updated: 1, removed: 0 };
      changedIds = [icon.id, before.id];
    } else if (command.type === 'node.group') {
      const ids = command.payload.nodeIds;
      if (ids.length === 0 || new Set(ids).size !== ids.length) throw new TypeError('node.group.invalid-targets');
      const paths = ids.map(id => {
        const path = findNodePath(icon, id);
        if (!path) throw new TypeError('node.not-found');
        return path;
      });
      const parentPath = paths[0]!.slice(0, -1);
      if (paths.some(path => path.length !== parentPath.length + 1
        || parentPath.some((part, offset) => path[offset] !== part))) {
        throw new TypeError('node.group.not-siblings');
      }
      const container = nodeArrayAt(copy, parentPath);
      const sorted = paths.map(path => Number(path.at(-1))).sort((left, right) => left - right);
      const children = sorted.map(index => container[index]!);
      const removalPatches = [...sorted].reverse().map(index => {
        const node = container.splice(index, 1)[0]!;
        return { op: 'remove' as const, path: ['icons', String(iconIndex), ...parentPath, String(index)], value: node };
      });
      const index = command.payload.index;
      if (!Number.isSafeInteger(index) || index < 0 || index > container.length) throw new TypeError('node.index.invalid');
      const group: SceneNodeV1 = { id: command.payload.groupId, type: 'group', visible: true, locked: false, children };
      container.splice(index, 0, group);
      const insertPath = ['icons', String(iconIndex), ...parentPath, String(index)];
      patches = [...removalPatches, { op: 'insert', path: insertPath, value: group }];
      inversePatches = [{ op: 'remove', path: insertPath, value: group },
        ...sorted.map((originalIndex, offset) => ({ op: 'insert' as const,
          path: ['icons', String(iconIndex), ...parentPath, String(originalIndex)], value: children[offset]! }))];
      count = { added: 1, updated: children.length, removed: 0 };
      changedIds = [icon.id, group.id, ...children.map(node => node.id)];
    } else if (command.type === 'node.ungroup') {
      const path = findNodePath(icon, command.payload.groupId);
      if (!path) throw new TypeError('node.not-found');
      const container = nodeArrayAt(copy, path.slice(0, -1));
      const index = Number(path.at(-1));
      const group = container[index]!;
      if (group.type !== 'group' || !group.visible || group.locked || group.transform !== undefined
        || group.opacity !== undefined || group.role !== undefined || group.name !== undefined) {
        throw new TypeError('node.ungroup.non-neutral');
      }
      if (icon.variants.some(variant => variant.overrides.some(override => override.nodeId === group.id))) {
        throw new TypeError('node.group.in-use');
      }
      container.splice(index, 1);
      const removePath = ['icons', String(iconIndex), ...path];
      const insertPatches = group.children.map((child, offset) => {
        container.splice(index + offset, 0, child);
        return { op: 'insert' as const, path: ['icons', String(iconIndex), ...path.slice(0, -1), String(index + offset)], value: child };
      });
      patches = [{ op: 'remove', path: removePath, value: group }, ...insertPatches];
      inversePatches = [...insertPatches].reverse().map(patch => ({ op: 'remove' as const,
        path: patch.path, value: patch.value }));
      inversePatches.push({ op: 'insert', path: removePath, value: group });
      count = { added: 0, updated: group.children.length, removed: 1 };
      changedIds = [icon.id, group.id, ...group.children.map(node => node.id)];
    } else if (command.type === 'node.reorder') {
      const sourcePath = findNodePath(icon, command.payload.nodeId);
      if (!sourcePath) throw new TypeError('node.not-found');
      const parentPath = command.payload.parentId === undefined ? null : findNodePath(icon, command.payload.parentId);
      if (command.payload.parentId !== undefined && !parentPath) throw new TypeError('node.parent.not-found');
      if (parentPath && sourcePath.length <= parentPath.length
        && sourcePath.every((part, offset) => part === parentPath[offset])) {
        throw new TypeError('node.reorder.invalid-parent');
      }
      const source = nodeArrayAt(copy, sourcePath.slice(0, -1));
      const removed = source.splice(Number(sourcePath.at(-1)), 1)[0]!;
      const destinationParentPath = command.payload.parentId === undefined ? null
        : findNodePath(copy, command.payload.parentId);
      if (command.payload.parentId !== undefined && !destinationParentPath) throw new TypeError('node.parent.not-found');
      const destinationPath = destinationParentPath === null ? ['nodes'] : [...destinationParentPath, 'children'];
      const destination = nodeArrayAt(copy, destinationPath);
      const index = command.payload.index;
      if (!Number.isSafeInteger(index) || index < 0 || index > destination.length) throw new TypeError('node.index.invalid');
      destination.splice(index, 0, removed);
      const removePath = ['icons', String(iconIndex), ...sourcePath];
      const insertPath = ['icons', String(iconIndex), ...destinationPath, String(index)];
      patches = [{ op: 'remove', path: removePath, value: removed },
        { op: 'insert', path: insertPath, value: removed }];
      inversePatches = [{ op: 'remove', path: insertPath, value: removed },
        { op: 'insert', path: removePath, value: removed }];
      count = { added: 0, updated: 1, removed: 0 };
      changedIds = [icon.id, removed.id];
    } else if (command.type === 'selection.transform') {
      const ids = command.payload.nodeIds;
      if (ids.length === 0 || new Set(ids).size !== ids.length) throw new TypeError('selection.invalid-targets');
      const matrix = command.payload.matrix;
      if (matrix.length !== 6 || matrix.some(value => !Number.isFinite(value))) throw new TypeError('selection.matrix.invalid');
      const normalized = quantizeMatrix(matrix);
      if (matrix.some((value, offset) => value !== normalized[offset])) throw new TypeError('selection.matrix.invalid');
      const paths = ids.map(id => {
        const path = findNodePath(icon, id);
        if (!path) throw new TypeError('node.not-found');
        return path;
      });
      if (paths.some((path, index) => paths.some((other, otherIndex) => index !== otherIndex
        && path.length < other.length && path.every((part, offset) => part === other[offset])))) {
        throw new TypeError('selection.overlap');
      }
      const transformPatches = paths.map(path => {
        const container = nodeArrayAt(copy, path.slice(0, -1));
        const index = Number(path.at(-1));
        const before = container[index]!;
        const [a, b, c, d, e, f] = matrix;
        const [g, h, i, j, k, l] = before.transform ?? [1, 0, 0, 1, 0, 0];
        const transform = quantizeMatrix([a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j,
          a * k + c * l + e, b * k + d * l + f]);
        const after = { ...before, transform };
        container[index] = after;
        return { op: 'replace' as const, path: ['icons', String(iconIndex), ...path], before, after };
      });
      patches = transformPatches;
      inversePatches = transformPatches.map(patch => ({ op: 'replace' as const, path: patch.path,
        before: patch.after, after: patch.before })).reverse();
      count = { added: 0, updated: ids.length, removed: 0 };
      changedIds = [icon.id, ...ids];
    } else {
      const ids = command.payload.nodeIds;
      if (ids.length === 0 || new Set(ids).size !== ids.length) throw new TypeError('node.remove.invalid-targets');
      const paths = ids.map(id => {
        const path = findNodePath(icon, id);
        if (!path) throw new TypeError('node.not-found');
        return path;
      });
      if (paths.some((path, index) => paths.some((other, otherIndex) => index !== otherIndex
        && path.length < other.length && path.every((part, offset) => part === other[offset])))) {
        throw new TypeError('node.remove.overlap');
      }
      paths.sort(removalOrder);
      const removalPatches = paths.map(path => {
        const container = nodeArrayAt(copy, path.slice(0, -1));
        const index = Number(path.at(-1));
        const removed = container.splice(index, 1)[0]!;
        return { op: 'remove' as const, path: ['icons', String(iconIndex), ...path], value: removed };
      });
      patches = removalPatches;
      inversePatches = removalPatches.map(patch => ({ op: 'insert' as const, path: patch.path, value: patch.value })).reverse();
      count = { added: 0, updated: 0, removed: paths.length };
      changedIds = [icon.id, ...ids];
    }
    const next = assertProject({ ...project, icons, revision: project.revision + 1 });
    return { project: next, patches, inversePatches,
      result: { commandId: command.commandId, status: command.dryRun ? 'dry-run' : 'applied', revision: next.revision,
        changedIds, patchSummary: { ...count, iconsAffected: [icon.id] }, diagnostics: [] } };
  }
  if (command.type === 'variant.add' || command.type === 'variant.update' || command.type === 'variant.remove') {
    const iconIndex = project.icons.findIndex(icon => icon.id === command.payload.iconId);
    if (iconIndex < 0) throw new TypeError('icon.not-found');
    const icon = project.icons[iconIndex]!;
    const variantId = command.type === 'variant.remove' ? command.payload.variantId : command.payload.variant.id;
    const variantIndex = icon.variants.findIndex(variant => variant.id === variantId);
    if (command.type === 'variant.add' && variantIndex >= 0) throw new TypeError('variant.already-exists');
    if (command.type !== 'variant.add' && variantIndex < 0) throw new TypeError('variant.not-found');
    const icons = structuredClone(project.icons);
    const variants = icons[iconIndex]!.variants;
    let patch: StructuralPatch;
    let inversePatch: StructuralPatch;
    let count: { added: number; updated: number; removed: number };
    if (command.type === 'variant.add') {
      const variant = structuredClone(command.payload.variant);
      const path = ['icons', String(iconIndex), 'variants', String(variants.length)];
      variants.push(variant);
      patch = { op: 'insert', path, value: variant };
      inversePatch = { op: 'remove', path, value: variant };
      count = { added: 1, updated: 0, removed: 0 };
    } else if (command.type === 'variant.remove') {
      const removed = variants.splice(variantIndex, 1)[0]!;
      const path = ['icons', String(iconIndex), 'variants', String(variantIndex)];
      patch = { op: 'remove', path, value: removed };
      inversePatch = { op: 'insert', path, value: removed };
      count = { added: 0, updated: 0, removed: 1 };
    } else {
      const before = variants[variantIndex]!;
      const after = structuredClone(command.payload.variant);
      variants[variantIndex] = after;
      const path = ['icons', String(iconIndex), 'variants', String(variantIndex)];
      patch = { op: 'replace', path, before, after };
      inversePatch = { op: 'replace', path, before: after, after: before };
      count = { added: 0, updated: 1, removed: 0 };
    }
    const next = assertProject({ ...project, icons, revision: project.revision + 1 });
    return { project: next, patches: [patch], inversePatches: [inversePatch],
      result: { commandId: command.commandId, status: command.dryRun ? 'dry-run' : 'applied', revision: next.revision,
        changedIds: [icon.id, variantId], patchSummary: { ...count, iconsAffected: [icon.id] }, diagnostics: [] } };
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
    } else if (command.type === 'icon.duplicate') {
      const copy = duplicateIcon(project, project.icons[index]!, command.payload.newIconId, command.payload.idMap);
      iconId = copy.id;
      const path = ['icons', String(icons.length)];
      icons.push(copy);
      count = { added: 1, updated: 0, removed: 0 };
      patches = [{ op: 'insert', path, value: copy }];
      inversePatches = [{ op: 'remove', path, value: copy }];
    } else if (command.type === 'icon.updateMetadata') {
      const patch = command.payload.patch;
      if (Object.keys(patch).length === 0) throw new TypeError('icon.metadata.empty-patch');
      const path = ['icons', String(index)];
      patches = [];
      inversePatches = [];
      for (const field of ['aliases', 'tags', 'accessibility'] as const) {
        if (!Object.hasOwn(patch, field)) continue;
        const before = icons[index]![field];
        const after = structuredClone(patch[field]);
        icons[index] = { ...icons[index]!, [field]: after } as IconV1;
        patches.push({ op: 'replace', path: [...path, field], before, after });
        inversePatches.push({ op: 'replace', path: [...path, field], before: after, after: before });
      }
      if (Object.hasOwn(patch, 'font')) {
        if (patch.font === undefined) throw new TypeError('icon.font.invalid');
        const before = icons[index]!.font;
        if (patch.font === null) {
          if (before === undefined) throw new TypeError('icon.font.not-set');
          const { font: _removed, ...withoutFont } = icons[index]!;
          icons[index] = withoutFont;
          patches.push({ op: 'remove', path: [...path, 'font'], value: before });
          inversePatches.push({ op: 'insert', path: [...path, 'font'], value: before });
        } else if (before === undefined) {
          const after = structuredClone(patch.font);
          icons[index] = { ...icons[index]!, font: after };
          patches.push({ op: 'insert', path: [...path, 'font'], value: after });
          inversePatches.push({ op: 'remove', path: [...path, 'font'], value: after });
        } else {
          const after = structuredClone(patch.font);
          icons[index] = { ...icons[index]!, font: after };
          patches.push({ op: 'replace', path: [...path, 'font'], before, after });
          inversePatches.push({ op: 'replace', path: [...path, 'font'], before: after, after: before });
        }
      }
      count = { added: 0, updated: 1, removed: 0 };
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
