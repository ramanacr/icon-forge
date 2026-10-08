import { ProjectDispatcher } from '@iconforge/application';
import { defaultDesignSystem, type CommandEnvelopeV1, type IconGridPreset, type ImportDiagnosticV1 } from '@iconforge/commands';
import { compileSpriteProfile, compileSvgProfile } from '@iconforge/compiler-core';
import { SelectionModel, TransformGesture } from '@iconforge/editor-core';
import { gridGuides, nodeGeometryBounds, snapPointToGrid } from '@iconforge/geometry';
import { prepareSvgImportInWorker } from '@iconforge/import-svg';
import { DexieProjectRepository, ProjectWriteLock, downloadBuildArchive, downloadProjectFile, openProjectArchive, readStorageDurability,
  requestPersistentStorage, pickProjectFileHandle, saveProjectFile, type StorageDurability, type WritableProjectHandle } from '@iconforge/persistence';
import { quantize, quantizeMatrix, type IconV1, type MatrixV1, type ProjectV1, type ProvenanceRecordV1, type SceneNodeV1 } from '@iconforge/project-model';
import { proposeFixForValidatedDiagnostic, proposeRuleFix, validateIconRules, type RuleDiagnostic } from '@iconforge/rules';
import { STARTER_ICONS, starterSvg, type StarterIconName } from './starter-library.js';
import { previewBatchInWorker } from './batch-preview.js';

const POINTER = 'iconforge:last-project';

export interface BatchStylePreview {
  revision: number;
  commandId: string;
  iconIds: string[];
  changes: { iconName: string; nodeName: string; before: string; after: string }[];
  icons: { iconName: string; before: string; after: string }[];
  notApplicable: { iconName: string; reason: string }[];
}

function uuidV7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let time = Date.now();
  for (let index = 5; index >= 0; index--) { bytes[index] = time & 255; time = Math.floor(time / 256); }
  bytes[6] = (bytes[6]! & 15) | 0x70;
  bytes[8] = (bytes[8]! & 63) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Browser boundary for journalled edits. The project pointer is only a convenience; IndexedDB is canonical. */
export class BrowserWorkspace {
  private readonly repository = new DexieProjectRepository('iconforge-web-v1');
  private dispatcher = new ProjectDispatcher();
  private lock: ProjectWriteLock | null = null;
  private unsubscribeMode: (() => void) | null = null;
  private pendingSave: Promise<void> | null = null;
  private fileHandle: WritableProjectHandle | null = null;
  private fileSavedProjectId: string | null = null;
  private fileSavedRevision: number | null = null;
  private compaction: Promise<void> | null = null;
  private idleCompaction: ReturnType<typeof setTimeout> | null = null;
  private drag: TransformGesture | null = null;
  private recovery: { kind: 'journal' | 'checkpoint'; projectId: string; storedRevision: number; validLength: number } | null = null;
  readonly selection = new SelectionModel();
  currentIconId: string | null = null;
  saveStatus = '';
  error = '';
  storageDurability: StorageDurability | null = null;
  onChanged: (() => void) | null = null;

  private savedStatus(): string {
    return this.project?.id === this.fileSavedProjectId && this.project.revision === this.fileSavedRevision
      ? 'Saved to file' : 'Saved in browser only';
  }

  get project(): ProjectV1 | null { return this.dispatcher.project; }
  get writable(): boolean { return this.lock?.mode === 'writer'; }
  get icon(): IconV1 | null { return this.project?.icons.find(icon => icon.id === this.currentIconId) ?? null; }
  get canExportSprite(): boolean { return Boolean(this.project?.exportProfiles.some(profile => profile.name === 'web-sprite' && profile.target === 'sprite')); }
  get hasUnsavedFileChanges(): boolean {
    return Boolean(this.project && (this.project.id !== this.fileSavedProjectId
      || this.project.revision !== this.fileSavedRevision));
  }
  get preview() { return this.drag?.preview; }
  get needsRecovery(): boolean { return this.recovery !== null; }
  get checkpointRecovery(): boolean { return this.recovery?.kind === 'checkpoint'; }
  get guides() { return this.icon ? gridGuides(this.icon.viewBox, [1, 1]) : null; }
  get ruleFindings(): (RuleDiagnostic & { fixable: boolean })[] {
    const project = this.project;
    const icon = this.icon;
    return project && icon ? validateIconRules(project, icon).map(item => ({ ...item,
      fixable: this.writable && proposeFixForValidatedDiagnostic(project, item) !== null })) : [];
  }
  get selectedNode(): SceneNodeV1 | null {
    const selectedIds = this.selection.snapshot.nodeIds;
    if (selectedIds.length !== 1) return null;
    const find = (nodes: SceneNodeV1[]): SceneNodeV1 | null => {
      for (const node of nodes) {
        if (node.id === selectedIds[0]) return node;
        if (node.type === 'group') {
          const nested = find(node.children);
          if (nested) return nested;
        }
      }
      return null;
    };
    return find(this.icon?.nodes ?? []);
  }
  get position(): [number, number] | null {
    const node = this.selectedNode;
    return node ? [node.transform?.[4] ?? 0, node.transform?.[5] ?? 0] : null;
  }
  get canUngroupSelection(): boolean {
    const node = this.selectedNode;
    if (!node || node.type !== 'group' || !node.visible || node.locked
      || node.transform !== undefined || node.opacity !== undefined
      || node.role !== undefined || node.name !== undefined) return false;
    return !this.icon?.variants.some(variant => variant.overrides.some(override => override.nodeId === node.id));
  }
  get canLayoutSelection(): boolean {
    const ids = this.selection.snapshot.nodeIds;
    const nodes = this.icon?.nodes ?? [];
    return ids.length >= 2 && ids.every(id => nodes.some(node => node.id === id && node.visible && !node.locked));
  }
  get styleableSelection(): boolean {
    const node = this.selectedNode;
    return Boolean(node && !node.locked && (node.type === 'rect' || node.type === 'ellipse'
      || node.type === 'path' || node.type === 'polyline'));
  }
  get fillColor(): string {
    const node = this.selectedNode;
    return node && 'fill' in node && node.fill?.kind === 'color' ? node.fill.value : '#000000';
  }
  get strokeWidth(): number | null {
    const node = this.selectedNode;
    return node && 'stroke' in node && node.stroke ? node.stroke.width : null;
  }
  get cornerRadius(): number | null {
    const node = this.selectedNode;
    return node?.type === 'rect' && !node.locked ? node.rx : null;
  }

  private base(projectId: string) {
    return { commandVersion: '1.0' as const, commandId: uuidV7(), projectId,
      expectedRevision: this.dispatcher.revision, issuedAt: new Date().toISOString(), actor: { kind: 'user' as const } };
  }

  private async openLock(projectId: string): Promise<void> {
    this.unsubscribeMode?.();
    await this.lock?.close();
    this.lock = await ProjectWriteLock.open(projectId, async () => {
      await this.pendingSave;
      await this.compaction;
    });
    this.unsubscribeMode = this.lock.onModeChange(mode => {
      if (!this.recovery) this.saveStatus = mode === 'writer' ? this.savedStatus() : 'Read only in this tab';
      this.onChanged?.();
    });
  }

  async openLast(): Promise<void> {
    const id = localStorage.getItem(POINTER);
    if (!id) return;
    const row = await this.repository.load(id);
    if (!row) { localStorage.removeItem(POINTER); return; }
    await this.openLock(id);
    this.loadRow(row);
    void this.refreshStorageDurability(id, false);
  }

  private async refreshStorageDurability(projectId: string, request: boolean): Promise<void> {
    const status = request ? await requestPersistentStorage() : await readStorageDurability();
    if (this.project?.id === projectId) {
      this.storageDurability = status;
      this.onChanged?.();
    }
  }

  private loadRow(row: NonNullable<Awaited<ReturnType<DexieProjectRepository['load']>>>): void {
    try {
      this.dispatcher = ProjectDispatcher.replay(row.snapshot, row.journal, row.checkpoint);
    } catch (error) {
      if (!(error instanceof TypeError) || error.message !== 'checkpoint.invalid') throw error;
      const salvaged = ProjectDispatcher.salvage(row.snapshot, row.journal);
      this.dispatcher = new ProjectDispatcher(salvaged.project);
      this.recovery = { kind: 'checkpoint', projectId: row.id, storedRevision: row.revision,
        validLength: salvaged.validLength };
      this.currentIconId = this.project?.icons.find(icon => icon.id === this.currentIconId)?.id
        ?? this.project?.icons[0]?.id ?? null;
      if (this.project) this.selection.reconcile(this.project);
      this.error = salvaged.corruptTail
        ? 'Saved history and journal tail are damaged. Valid edits are shown read only. Download recovery data, then recover as copy. The original stays stored; undo history starts fresh.'
        : 'Saved history is damaged. All journal edits are shown read only. Download recovery data, then recover as copy. The original stays stored; undo history starts fresh.';
      this.saveStatus = 'Recovery needed';
      return;
    }
    this.currentIconId = this.project?.icons.find(icon => icon.id === this.currentIconId)?.id
      ?? this.project?.icons[0]?.id ?? null;
    if (this.project) this.selection.reconcile(this.project);
    if (this.dispatcher.recoveryDiagnostics.length) {
      this.recovery = { kind: 'journal', projectId: row.id, storedRevision: row.revision,
        validLength: this.dispatcher.revision - (row.snapshot?.revision ?? 0) };
      this.error = 'A damaged journal tail was found. Recover valid edits to continue.';
      this.saveStatus = 'Recovery needed';
      return;
    }
    this.recovery = null;
    this.error = '';
    this.saveStatus = this.writable ? this.savedStatus() : 'Read only in this tab';
    if (this.writable && this.dispatcher.journalLength) void this.scheduleCompaction(row.id);
  }

  private async scheduleCompaction(projectId: string): Promise<void> {
    if (this.idleCompaction) clearTimeout(this.idleCompaction);
    this.idleCompaction = null;
    if (this.dispatcher.journalLength === 0) return;
    if (this.dispatcher.journalLength >= 200) { await this.compactJournal(projectId); return; }
    this.idleCompaction = setTimeout(() => {
      this.idleCompaction = null;
      void this.compactJournal(projectId);
    }, 30_000);
  }

  private async compactJournal(projectId: string): Promise<void> {
    if (this.compaction) { await this.compaction; return; }
    const snapshot = this.dispatcher.project;
    if (!snapshot || snapshot.id !== projectId || !this.writable || this.recovery
      || this.dispatcher.journalLength === 0) return;
    const checkpoint = this.dispatcher.checkpoint();
    const work = (async (): Promise<void> => {
      try {
        await this.repository.compact(projectId, snapshot.revision, snapshot, checkpoint);
        if (this.dispatcher.revision === snapshot.revision && this.project?.id === projectId) {
          this.dispatcher = ProjectDispatcher.replay(snapshot, [], checkpoint);
        }
      } catch { /* The committed journal remains authoritative; retry after the next edit. */ }
    })();
    this.compaction = work;
    try { await work; }
    finally { if (this.compaction === work) this.compaction = null; }
  }

  async refreshReadonly(): Promise<void> {
    if (this.writable) return;
    const id = localStorage.getItem(POINTER);
    if (!id) return;
    const row = await this.repository.load(id);
    if (row) this.loadRow(row);
  }

  async takeOver(): Promise<void> {
    if (!this.lock || !(await this.lock.takeOver())) throw new TypeError('Could not take over editing');
    const id = localStorage.getItem(POINTER);
    const row = id ? await this.repository.load(id) : null;
    if (row) this.loadRow(row);
  }

  async recover(): Promise<void> {
    const damaged = this.recovery;
    if (!damaged || !this.writable) throw new TypeError('Recovery requires the editing lock');
    if (damaged.kind === 'checkpoint') {
      const source = this.project;
      if (!source) throw new TypeError('No valid project to recover');
      const latest = await this.repository.load(damaged.projectId);
      if (!latest || latest.revision !== damaged.storedRevision) throw new TypeError('revision.conflict');
      const copy = { ...source, id: uuidV7() };
      await this.repository.insertSnapshot(copy);
      this.fileHandle = null;
      this.fileSavedProjectId = null;
      this.fileSavedRevision = null;
      await this.openLock(copy.id);
      localStorage.setItem(POINTER, copy.id);
      this.loadRow((await this.repository.load(copy.id))!);
      this.saveStatus = 'Recovered as a copy';
      return;
    }
    await this.repository.truncateJournal(damaged.projectId, damaged.storedRevision, damaged.validLength);
    this.recovery = null;
    this.error = '';
    this.saveStatus = 'Recovered valid edits';
    this.lock!.publishRevision(this.dispatcher.revision);
  }

  async downloadRecoveryData(): Promise<void> {
    const damaged = this.recovery;
    if (!damaged) throw new TypeError('No recovery data is available');
    const row = await this.repository.load(damaged.projectId);
    if (!row) throw new TypeError('Recovery data is missing');
    const blob = new Blob([JSON.stringify(row)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${row.id}-recovery.json`;
      document.body.append(link);
      link.click();
      link.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  private async persist(command: CommandEnvelopeV1, originalSvg?: Uint8Array): Promise<void> {
    if (!this.writable || this.recovery) throw new TypeError('Project is read only until recovery is complete');
    if (command.type === 'icon.importSvg' && !originalSvg) throw new TypeError('import.original-required');
    if (this.idleCompaction) clearTimeout(this.idleCompaction);
    this.idleCompaction = null;
    const before = this.dispatcher.revision;
    try { this.dispatcher.dispatch(command); }
    catch (error) { await this.scheduleCompaction(command.projectId); throw error; }
    const entry = this.dispatcher.journal.at(-1)!;
    const write = command.type === 'icon.importSvg'
      ? this.repository.appendImport(command.projectId, before, this.dispatcher.revision, entry, originalSvg!)
      : this.repository.append(command.projectId, before, this.dispatcher.revision, entry);
    this.pendingSave = write;
    try {
      await write;
      if (this.lock?.mode === 'writer') this.lock.publishRevision(this.dispatcher.revision);
      this.saveStatus = this.savedStatus();
      this.error = '';
      if (this.project) this.selection.reconcile(this.project);
    } catch (error) {
      const row = await this.repository.load(command.projectId);
      this.dispatcher = row ? ProjectDispatcher.replay(row.snapshot, row.journal, row.checkpoint) : new ProjectDispatcher();
      this.error = error instanceof Error ? error.message : String(error);
      this.saveStatus = 'Save failed';
      await this.scheduleCompaction(command.projectId);
      throw error;
    } finally {
      if (this.pendingSave === write) this.pendingSave = null;
    }
    await this.scheduleCompaction(command.projectId);
  }

  async create(gridSize: IconGridPreset = 24): Promise<void> {
    if (![16, 24, 32].includes(gridSize)) throw new TypeError('Unknown icon grid preset');
    const id = uuidV7();
    this.fileHandle = null;
    this.fileSavedProjectId = null;
    this.fileSavedRevision = null;
    await this.openLock(id);
    this.dispatcher = new ProjectDispatcher();
    this.recovery = null;
    this.selection.clear();
    this.currentIconId = null;
    this.storageDurability = null;
    await this.persist({ ...this.base(id), type: 'project.create', payload: {
      id, name: 'Untitled project', designSystem: defaultDesignSystem(gridSize),
    } });
    localStorage.setItem(POINTER, id);
    await this.persist({ ...this.base(id), type: 'exportProfile.upsert',
      payload: { profile: { id: uuidV7(), name: 'web-svg', target: 'svg',
        options: { precision: 3, sizeAttrs: true, paintMode: 'currentColor', metadata: false } } } });
    await this.persist({ ...this.base(id), type: 'exportProfile.upsert',
      payload: { profile: { id: uuidV7(), name: 'web-sprite', target: 'sprite',
        options: { idPrefix: 'if-', precision: 3 } } } });
    void this.refreshStorageDurability(id, true);
  }

  async renameProject(requestedName: string): Promise<void> {
    const project = this.project;
    if (!project) throw new TypeError('Create a project first');
    const name = requestedName.trim();
    if (!name || name.length > 120) throw new TypeError('Project name must be 1–120 characters');
    if (name === project.name) return;
    await this.persist({ ...this.base(project.id), type: 'project.rename', payload: { name } });
  }

  async addIcon(): Promise<void> {
    const project = this.project;
    if (!project) throw new TypeError('Create a project first');
    let index = 1;
    while (project.icons.some(icon => icon.name === `icon-${index}`)) index++;
    const icon: IconV1 = { id: uuidV7(), name: `icon-${index}`, aliases: [], tags: [],
      viewBox: [0, 0, project.designSystem.grid.width, project.designSystem.grid.height],
      nodes: [], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [] };
    await this.persist({ ...this.base(project.id), type: 'icon.add', payload: { icon } });
    this.currentIconId = icon.id;
    this.selection.clear();
  }

  async renameIcon(requestedName: string): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    if (!project || !icon) throw new TypeError('Select an icon first');
    const name = requestedName.trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw new TypeError('Icon name must use letters, numbers and hyphens');
    }
    if (name === icon.name) return;
    await this.persist({ ...this.base(project.id), type: 'icon.rename', payload: { iconId: icon.id, name } });
  }

  async setIconAccessibility(kind: IconV1['accessibility']['kind'], requestedLabel: string): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    if (!project || !icon) throw new TypeError('Select an icon first');
    if (kind !== 'decorative' && kind !== 'informative') throw new TypeError('Unknown icon accessibility kind');
    const label = requestedLabel.trim();
    if (kind === 'informative' && (!label || label.length > 120)) {
      throw new TypeError('Informative icons need a label of 1–120 characters');
    }
    const accessibility = kind === 'decorative' ? { kind } : { kind, label };
    if (JSON.stringify(icon.accessibility) === JSON.stringify(accessibility)) return;
    await this.persist({ ...this.base(project.id), type: 'icon.updateMetadata',
      payload: { iconId: icon.id, patch: { accessibility } } });
  }

  async updateSetStyle(style: ProjectV1['designSystem']['style'], width: number, cornerRadius: number): Promise<void> {
    const project = this.project;
    if (!project) throw new TypeError('Create a project first');
    if (!['outline', 'filled', 'duotone', 'custom'].includes(style)
      || !Number.isFinite(width) || width <= 0 || width > 24
      || !Number.isFinite(cornerRadius) || cornerRadius < 0 || cornerRadius > 12) {
      throw new TypeError('Enter a valid style, stroke width and roundness');
    }
    const strokeWidth = quantize(width);
    const roundness = quantize(cornerRadius);
    if (project.designSystem.style === style && project.designSystem.stroke.width === strokeWidth
      && project.designSystem.cornerRadius === roundness) return;
    await this.persist({ ...this.base(project.id), type: 'project.updateDesignSystem', payload: { patch: {
      style, stroke: { ...project.designSystem.stroke, width: strokeWidth }, cornerRadius: roundness,
    } } });
  }

  async previewBatchStrokePolicy(): Promise<BatchStylePreview> {
    const project = this.project;
    if (!project || !this.writable || !project.icons.length) throw new TypeError('Add icons before applying a set style');
    const iconIds = project.icons.map(icon => icon.id);
    const base = this.base(project.id);
    const preview = await previewBatchInWorker(project, { ...base, dryRun: true,
      type: 'set.applyStyle', payload: { iconIds, changes: [{ op: 'setStrokePolicy' }] } });
    const format = (node: SceneNodeV1): string => {
      if (!('stroke' in node) || !node.stroke) throw new TypeError('Batch diff is not a stroke');
      return `${node.stroke.width} units · ${node.stroke.cap} cap · ${node.stroke.join} join · ${node.stroke.miterLimit} miter limit`;
    };
    const changes = preview.patches.map(patch => {
      if (patch.op !== 'replace') throw new TypeError('Batch diff is not a replacement');
      const icon = project.icons[Number(patch.path[1])]!;
      const before = patch.before as SceneNodeV1;
      const after = patch.after as SceneNodeV1;
      return { iconName: icon.name, nodeName: before.name ?? before.type,
        before: format(before), after: format(after) };
    });
    const icons = preview.icons.map(item => ({ iconName: project.icons.find(icon => icon.id === item.iconId)!.name,
      before: `data:image/svg+xml,${encodeURIComponent(item.beforeSvg)}`,
      after: `data:image/svg+xml,${encodeURIComponent(item.afterSvg)}` }));
    const notApplicable = preview.notApplicable.map(item => ({
      iconName: project.icons.find(icon => icon.id === item.iconId)!.name, reason: item.reason }));
    return { revision: project.revision, commandId: base.commandId,
      iconIds: preview.iconIds, changes, icons, notApplicable };
  }

  async applyBatchStrokePolicy(preview: BatchStylePreview): Promise<void> {
    const project = this.project;
    if (!project || !this.writable || project.revision !== preview.revision
      || !preview.changes.length || !preview.iconIds.length
      || new Set(preview.iconIds).size !== preview.iconIds.length
      || preview.iconIds.some(iconId => !project.icons.some(icon => icon.id === iconId))) {
      throw new TypeError('Batch preview is stale; preview again');
    }
    await this.persist({ ...this.base(project.id), confirmsDryRun: preview.commandId,
      type: 'set.applyStyle', payload: { iconIds: preview.iconIds,
        changes: [{ op: 'setStrokePolicy' }] } });
  }

  async applyRuleFix(diagnostic: RuleDiagnostic): Promise<void> {
    const project = this.project;
    if (!project || !this.writable) throw new TypeError('Project is read only');
    const proposal = proposeRuleFix(project, diagnostic);
    if (!proposal) throw new TypeError('Rule fix is stale or unsupported');
    const fix = { ...this.base(project.id), ...proposal };
    await this.persist({ ...this.base(project.id), type: 'rule.applyFix',
      payload: { diagnostic: { code: diagnostic.code, severity: diagnostic.severity,
        iconId: diagnostic.iconId, nodeId: diagnostic.nodeId, message: diagnostic.message, fix } } });
  }

  async importSvg(originalSvg: Uint8Array, requestedName: string,
    provenance: Pick<ProvenanceRecordV1, 'source' | 'author' | 'license' | 'attribution'> = {}): Promise<ImportDiagnosticV1[]> {
    const project = this.project;
    if (!project) throw new TypeError('Create a project first');
    if (!this.writable || this.recovery) throw new TypeError('Project is read only until recovery is complete');
    const baseName = requestedName.replace(/\.svg$/i, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
      || 'imported-icon';
    let name = baseName;
    let suffix = 2;
    while (project.icons.some(icon => icon.name === name)) {
      const tail = `-${suffix++}`;
      name = `${baseName.slice(0, 64 - tail.length)}${tail}`;
    }
    const prepared = await prepareSvgImportInWorker(originalSvg, {
      iconId: uuidV7(), provenanceId: uuidV7(), name,
    });
    await this.persist({ ...this.base(project.id), type: 'icon.importSvg',
      payload: { icon: prepared.icon, provenance: { ...prepared.provenance, source: requestedName, ...provenance },
        diagnostics: prepared.diagnostics } },
    prepared.originalSvg);
    this.currentIconId = prepared.icon.id;
    this.selection.clear();
    return prepared.diagnostics;
  }

  async addStarterIcon(name: StarterIconName): Promise<void> {
    if (!STARTER_ICONS.some(icon => icon.name === name)) throw new TypeError('starter.not-found');
    const originalSvg = new TextEncoder().encode(starterSvg(name, this.project?.designSystem.grid.width ?? 24));
    await this.importSvg(originalSvg, `${name}.svg`, {
      source: `IconForge starter library/${name}.svg`, author: 'Ramana Reddy Chamakura',
      license: 'MIT', attribution: 'Copyright (c) 2026 Ramana Reddy Chamakura',
    });
  }

  async addRectangle(rounded = false): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    if (!project || !icon) throw new TypeError('Add an icon first');
    const size = project.designSystem.grid.width;
    const inset = Math.round(size / 6);
    const radius = rounded ? Math.min(project.designSystem.cornerRadius, (size - inset * 2) / 2) : 0;
    const node: SceneNodeV1 = { id: uuidV7(), type: 'rect', visible: true, locked: false,
      x: inset, y: inset, width: size - inset * 2, height: size - inset * 2,
      rx: radius, ry: radius, fill: { kind: 'token', token: project.designSystem.defaultPaintToken } };
    await this.persist({ ...this.base(project.id), type: 'node.add',
      payload: { iconId: icon.id, index: icon.nodes.length, node } });
  }

  async addPolygon(closed = true): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    if (!project || !icon) throw new TypeError('Add an icon first');
    const size = project.designSystem.grid.width;
    const inset = Math.round(size / 6);
    const node: SceneNodeV1 = { id: uuidV7(), type: 'polyline', visible: true, locked: false,
      points: [inset, size - inset, size / 2, inset, size - inset, size - inset], closed,
      fill: closed ? { kind: 'token', token: project.designSystem.defaultPaintToken } : { kind: 'none' },
      ...(closed ? {} : { stroke: { paint: { kind: 'token' as const, token: project.designSystem.defaultPaintToken },
        ...project.designSystem.stroke } }) };
    await this.persist({ ...this.base(project.id), type: 'node.add',
      payload: { iconId: icon.id, index: icon.nodes.length, node } });
  }

  async addEllipse(): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    if (!project || !icon) throw new TypeError('Add an icon first');
    const size = project.designSystem.grid.width;
    const radius = Math.round(size / 3);
    const node: SceneNodeV1 = { id: uuidV7(), type: 'ellipse', visible: true, locked: false,
      cx: size / 2, cy: size / 2, rx: radius, ry: radius,
      fill: { kind: 'token', token: project.designSystem.defaultPaintToken } };
    await this.persist({ ...this.base(project.id), type: 'node.add',
      payload: { iconId: icon.id, index: icon.nodes.length, node } });
  }

  async addLine(): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    if (!project || !icon) throw new TypeError('Add an icon first');
    const size = project.designSystem.grid.width;
    const inset = Math.round(size / 6);
    const node: SceneNodeV1 = { id: uuidV7(), type: 'line', visible: true, locked: false,
      x1: inset, y1: size - inset, x2: size - inset, y2: inset,
      stroke: { paint: { kind: 'token', token: project.designSystem.defaultPaintToken },
        ...project.designSystem.stroke } };
    await this.persist({ ...this.base(project.id), type: 'node.add',
      payload: { iconId: icon.id, index: icon.nodes.length, node } });
  }

  select(nodeId: string, toggle = false): void {
    const project = this.project;
    const icon = this.icon;
    if (project && icon) {
      if (toggle) this.selection.toggle(project, icon.id, nodeId);
      else this.selection.replace(project, icon.id, [nodeId]);
    }
  }

  async groupSelected(): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    const nodeIds = this.selection.snapshot.nodeIds;
    if (!project || !icon || nodeIds.length < 2) return;
    const positions = nodeIds.map(id => icon.nodes.findIndex(node => node.id === id));
    if (positions.some(index => index < 0)) throw new TypeError('Group top-level layers only');
    const groupId = uuidV7();
    await this.persist({ ...this.base(project.id), type: 'node.group',
      payload: { iconId: icon.id, nodeIds, groupId, index: Math.min(...positions) } });
    this.selection.replace(this.project!, icon.id, [groupId]);
  }

  async ungroupSelected(): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    const ids = this.selection.snapshot.nodeIds;
    const group = icon?.nodes.find(node => node.id === ids[0] && node.type === 'group');
    if (!project || !icon || ids.length !== 1 || !group || group.type !== 'group') return;
    const children = group.children.map(node => node.id);
    await this.persist({ ...this.base(project.id), type: 'node.ungroup',
      payload: { iconId: icon.id, groupId: group.id } });
    this.selection.replace(this.project!, icon.id, children);
  }

  async removeSelected(): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    const nodeIds = this.selection.snapshot.nodeIds;
    if (!project || !icon || nodeIds.length === 0) return;
    await this.persist({ ...this.base(project.id), type: 'node.remove',
      payload: { iconId: icon.id, nodeIds } });
  }

  async setSelectedAppearance(mode: 'filled' | 'outline'): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    const nodeId = this.selection.snapshot.nodeIds[0];
    if (!project || !icon || !nodeId || !this.styleableSelection) return;
    const paint = { kind: 'token' as const, token: project.designSystem.defaultPaintToken };
    await this.persist({ ...this.base(project.id), type: 'node.update', payload: {
      iconId: icon.id, nodeId, ops: mode === 'outline'
        ? [{ op: 'setFill', fill: { kind: 'none' } },
          { op: 'setStroke', stroke: { paint, ...project.designSystem.stroke } }]
        : [{ op: 'setFill', fill: paint }, { op: 'setStroke', stroke: null }],
    } });
  }

  async setFillColor(color: string): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    const node = this.selectedNode;
    if (!project || !icon || !node || !this.styleableSelection) throw new TypeError('Select a fillable shape');
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new TypeError('Fill color must be a hex color');
    await this.persist({ ...this.base(project.id), type: 'node.update', payload: {
      iconId: icon.id, nodeId: node.id, ops: [{ op: 'setFill', fill: { kind: 'color', value: color.toLowerCase() } }],
    } });
  }

  async setStrokeWidth(width: number): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    const node = this.selectedNode;
    if (!project || !icon || !node || node.locked || !('stroke' in node) || !node.stroke) {
      throw new TypeError('Select a stroked shape');
    }
    if (!Number.isFinite(width) || width <= 0) throw new TypeError('Stroke width must be positive');
    const stroke = { ...node.stroke, width: quantize(width) };
    await this.persist({ ...this.base(project.id), type: 'node.update', payload: {
      iconId: icon.id, nodeId: node.id, ops: [{ op: 'setStroke', stroke }],
    } });
  }

  async setCornerRadius(radius: number): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    const node = this.selectedNode;
    if (!project || !icon || !node || node.type !== 'rect' || node.locked) {
      throw new TypeError('Select an unlocked rectangle to edit roundness');
    }
    if (!Number.isFinite(radius) || radius < 0 || radius > Math.min(node.width, node.height) / 2) {
      throw new TypeError('Roundness must fit inside the rectangle');
    }
    const rounded = quantize(radius);
    if (node.rx === rounded && node.ry === rounded) return;
    await this.persist({ ...this.base(project.id), type: 'node.update', payload: {
      iconId: icon.id, nodeId: node.id, ops: [{ op: 'setCornerRadius', radius: rounded }],
    } });
  }

  beginDrag(nodeId: string): void {
    const project = this.project;
    const icon = this.icon;
    if (!project || !icon || !this.writable) return;
    if (!this.selection.snapshot.nodeIds.includes(nodeId)) this.select(nodeId);
    this.drag = new TransformGesture(this.dispatcher, { ...this.base(project.id),
      iconId: icon.id, nodeIds: this.selection.snapshot.nodeIds });
  }

  updateDrag(dx: number, dy: number, tolerance: number): void {
    if (!this.drag) return;
    const snapped = snapPointToGrid([dx, dy], [1, 1], [0, 0], tolerance).point;
    const q = (value: number): number => Math.round(value * 1000) / 1000;
    this.drag.update([1, 0, 0, 1, q(snapped[0]), q(snapped[1])]);
  }

  cancelDrag(): void { this.drag?.cancel(); this.drag = null; }

  private async commitGesture(gesture: TransformGesture, projectId: string): Promise<void> {
    if (this.idleCompaction) clearTimeout(this.idleCompaction);
    this.idleCompaction = null;
    const before = this.dispatcher.revision;
    if (!gesture.commit()) { await this.scheduleCompaction(projectId); return; }
    const entry = this.dispatcher.journal.at(-1)!;
    const write = this.repository.append(projectId, before, this.dispatcher.revision, entry);
    this.pendingSave = write;
    try {
      await write;
      if (this.lock?.mode === 'writer') this.lock.publishRevision(this.dispatcher.revision);
      this.saveStatus = this.savedStatus();
      this.error = '';
    } catch (error) {
      const row = await this.repository.load(projectId);
      this.dispatcher = row ? ProjectDispatcher.replay(row.snapshot, row.journal, row.checkpoint) : new ProjectDispatcher();
      await this.scheduleCompaction(projectId);
      throw error;
    } finally {
      if (this.pendingSave === write) this.pendingSave = null;
    }
    await this.scheduleCompaction(projectId);
  }

  async finishDrag(): Promise<void> {
    const gesture = this.drag;
    this.drag = null;
    const id = this.project?.id;
    if (gesture && id) await this.commitGesture(gesture, id);
  }

  async translateSelected(dx: number, dy: number): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    const nodeIds = this.selection.snapshot.nodeIds;
    if (!project || !icon || !nodeIds.length || !this.writable) return;
    const gesture = new TransformGesture(this.dispatcher, { ...this.base(project.id), iconId: icon.id, nodeIds });
    gesture.update([1, 0, 0, 1, dx, dy]);
    await this.commitGesture(gesture, project.id);
  }

  async setPosition(x: number, y: number): Promise<void> {
    const node = this.selectedNode;
    const position = this.position;
    const project = this.project;
    const icon = this.icon;
    if (!node || !position || !project || !icon || node.locked) throw new TypeError('Select an unlocked layer');
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Position must be finite');
    const matrix = quantizeMatrix([1, 0, 0, 1, x - position[0], y - position[1]]);
    const gesture = new TransformGesture(this.dispatcher, { ...this.base(project.id),
      iconId: icon.id, nodeIds: [node.id] });
    gesture.update(matrix);
    await this.commitGesture(gesture, project.id);
  }

  async setLayerVisible(nodeId: string, visible: boolean): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    if (!project || !icon || !this.writable) throw new TypeError('Project is read only');
    await this.persist({ ...this.base(project.id), type: 'node.update',
      payload: { iconId: icon.id, nodeId, ops: [{ op: 'setVisible', value: visible }] } });
  }

  async setLayerLocked(nodeId: string, locked: boolean): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    if (!project || !icon || !this.writable) throw new TypeError('Project is read only');
    await this.persist({ ...this.base(project.id), type: 'node.update',
      payload: { iconId: icon.id, nodeId, ops: [{ op: 'setLocked', value: locked }] } });
  }

  private async transformSelectedAroundCenter(a: number, b: number, c: number, d: number): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    const node = this.selectedNode;
    if (!project || !icon || !node || node.locked || !this.writable) throw new TypeError('Select an unlocked layer');
    const bounds = nodeGeometryBounds(project, node);
    if (!bounds) throw new TypeError('Selected layer has no visible geometry');
    const x = (bounds.minX + bounds.maxX) / 2;
    const y = (bounds.minY + bounds.maxY) / 2;
    const matrix = quantizeMatrix([a, b, c, d, x - a * x - c * y, y - b * x - d * y]);
    const gesture = new TransformGesture(this.dispatcher, { ...this.base(project.id),
      iconId: icon.id, nodeIds: [node.id] });
    gesture.update(matrix);
    await this.commitGesture(gesture, project.id);
  }

  async scaleSelected(percent: number): Promise<void> {
    if (!Number.isFinite(percent) || percent <= 0 || percent > 1000) {
      throw new TypeError('Scale percent must be greater than 0 and at most 1000');
    }
    const factor = percent / 100;
    await this.transformSelectedAroundCenter(factor, 0, 0, factor);
  }

  async rotateSelected(degrees: number): Promise<void> {
    if (!Number.isFinite(degrees) || Math.abs(degrees) > 360) {
      throw new TypeError('Rotation must be between -360 and 360 degrees');
    }
    const radians = degrees * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    await this.transformSelectedAroundCenter(cosine, sine, -sine, cosine);
  }

  async flipSelected(axis: 'horizontal' | 'vertical'): Promise<void> {
    await this.transformSelectedAroundCenter(axis === 'horizontal' ? -1 : 1, 0,
      0, axis === 'vertical' ? -1 : 1);
  }

  async layoutSelected(kind: 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'
    | 'distribute-x' | 'distribute-y'): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    const ids = this.selection.snapshot.nodeIds;
    if (!project || !icon || !this.writable || !this.canLayoutSelection) {
      throw new TypeError('Select at least two unlocked visible layers');
    }
    if (kind.startsWith('distribute') && ids.length < 3) throw new TypeError('Select at least three layers to distribute');
    const entries = ids.map(nodeId => {
      const node = icon.nodes.find(node => node.id === nodeId)!;
      const bounds = nodeGeometryBounds(project, node);
      if (!bounds) throw new TypeError('Selected layer has no visible geometry');
      return { nodeId, bounds, centerX: (bounds.minX + bounds.maxX) / 2,
        centerY: (bounds.minY + bounds.maxY) / 2 };
    });
    const left = Math.min(...entries.map(entry => entry.bounds.minX));
    const right = Math.max(...entries.map(entry => entry.bounds.maxX));
    const top = Math.min(...entries.map(entry => entry.bounds.minY));
    const bottom = Math.max(...entries.map(entry => entry.bounds.maxY));
    const moves = new Map<string, [number, number]>();
    if (kind === 'distribute-x' || kind === 'distribute-y') {
      const horizontal = kind === 'distribute-x';
      const ordered = [...entries].sort((a, b) => horizontal
        ? a.centerX - b.centerX : a.centerY - b.centerY);
      const start = horizontal ? ordered[0]!.centerX : ordered[0]!.centerY;
      const end = horizontal ? ordered.at(-1)!.centerX : ordered.at(-1)!.centerY;
      ordered.forEach((entry, index) => {
        const current = horizontal ? entry.centerX : entry.centerY;
        const delta = start + (end - start) * index / (ordered.length - 1) - current;
        moves.set(entry.nodeId, horizontal ? [delta, 0] : [0, delta]);
      });
    } else {
      for (const entry of entries) {
        const dx = kind === 'left' ? left - entry.bounds.minX
          : kind === 'right' ? right - entry.bounds.maxX
            : kind === 'center-x' ? (left + right) / 2 - entry.centerX : 0;
        const dy = kind === 'top' ? top - entry.bounds.minY
          : kind === 'bottom' ? bottom - entry.bounds.maxY
            : kind === 'center-y' ? (top + bottom) / 2 - entry.centerY : 0;
        moves.set(entry.nodeId, [dx, dy]);
      }
    }
    const transforms = entries.map(entry => {
      const [dx, dy] = moves.get(entry.nodeId)!;
      return { nodeId: entry.nodeId,
        matrix: quantizeMatrix([1, 0, 0, 1, dx, dy]) as MatrixV1 };
    }).filter(entry => entry.matrix[4] !== 0 || entry.matrix[5] !== 0);
    if (!transforms.length) return;
    await this.persist({ ...this.base(project.id), type: 'selection.transformMany',
      payload: { iconId: icon.id, transforms } });
  }

  async moveRight(): Promise<void> { await this.translateSelected(1, 0); }

  async undo(): Promise<void> {
    const project = this.project;
    if (project) await this.persist({ ...this.base(project.id), type: 'history.undo', payload: {} });
  }

  async redo(): Promise<void> {
    const project = this.project;
    if (project) await this.persist({ ...this.base(project.id), type: 'history.redo', payload: {} });
  }

  exportSvg(): void {
    const project = this.project;
    const icon = this.icon;
    if (!project || !icon) return;
    const bytes = compileSvgProfile(project, 'web-svg').artifacts[`${icon.name}.svg`];
    if (!bytes) throw new TypeError('SVG artifact missing');
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/svg+xml' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${icon.name}.svg`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async downloadProject(): Promise<void> {
    const project = this.project;
    if (!project) throw new TypeError('No project to download');
    await downloadProjectFile(project, await this.repository.loadOriginals(project.id));
  }

  async saveProject(): Promise<void> {
    const project = this.project;
    if (!project) throw new TypeError('No project to save');
    if (!this.writable || this.recovery) throw new TypeError('Project is read only until recovery is complete');
    const handle = (this.fileSavedProjectId === project.id ? this.fileHandle : null)
      ?? await pickProjectFileHandle(project.name);
    const attachments = await this.repository.loadOriginals(project.id);
    const saved = await saveProjectFile(project, handle
      ? { handle, attachments }
      : { picker: async () => undefined, attachments });
    if (this.project?.id === project.id) {
      this.fileHandle = saved.method === 'file' ? saved.handle : null;
      this.fileSavedProjectId = project.id;
      this.fileSavedRevision = saved.revision;
      this.saveStatus = this.savedStatus();
      this.onChanged?.();
    }
  }

  async downloadSprite(): Promise<void> {
    const project = this.project;
    if (!project) throw new TypeError('No project to export');
    const build = compileSpriteProfile(project, 'web-sprite');
    const filename = `${project.name.replace(/[^A-Za-z0-9 _.-]/g, '_').slice(0, 110) || 'project'}-sprite.zip`;
    await downloadBuildArchive(filename, build.artifacts, build.manifestBytes);
  }

  async openProjectFile(bytes: Uint8Array): Promise<void> {
    const opened = await openProjectArchive(bytes);
    if (opened.mode !== 'read-write') throw new TypeError(`project-archive.${opened.reason}`);
    await this.pendingSave;
    const collision = await this.repository.load(opened.project.id);
    const project = collision ? { ...opened.project, id: uuidV7() } : opened.project;
    this.fileHandle = null;
    this.fileSavedProjectId = null;
    this.fileSavedRevision = null;
    await this.repository.insertArchive(project, opened.attachments);
    await this.openLock(project.id);
    localStorage.setItem(POINTER, project.id);
    this.selection.clear();
    this.currentIconId = project.icons[0]?.id ?? null;
    this.loadRow((await this.repository.load(project.id))!);
    this.saveStatus = collision ? 'Restored as a copy' : 'Restored from project file';
    this.storageDurability = null;
    void this.refreshStorageDurability(project.id, false);
    this.onChanged?.();
  }

  async close(): Promise<void> {
    if (this.idleCompaction) clearTimeout(this.idleCompaction);
    await this.pendingSave;
    await this.compaction;
    this.unsubscribeMode?.();
    await this.lock?.close();
    this.repository.close();
  }
}
