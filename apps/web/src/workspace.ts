import { ProjectDispatcher } from '@iconforge/application';
import type { CommandEnvelopeV1 } from '@iconforge/commands';
import { compileSvgProfile } from '@iconforge/compiler-core';
import { SelectionModel, TransformGesture } from '@iconforge/editor-core';
import { gridGuides, snapPointToGrid } from '@iconforge/geometry';
import { DexieProjectRepository, ProjectWriteLock, requestPersistentStorage } from '@iconforge/persistence';
import type { IconV1, ProjectV1, SceneNodeV1 } from '@iconforge/project-model';

const POINTER = 'iconforge:last-project';

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
  private drag: TransformGesture | null = null;
  private recovery: { projectId: string; storedRevision: number; validLength: number } | null = null;
  readonly selection = new SelectionModel();
  currentIconId: string | null = null;
  saveStatus = '';
  error = '';
  onChanged: (() => void) | null = null;

  get project(): ProjectV1 | null { return this.dispatcher.project; }
  get writable(): boolean { return this.lock?.mode === 'writer'; }
  get icon(): IconV1 | null { return this.project?.icons.find(icon => icon.id === this.currentIconId) ?? null; }
  get preview() { return this.drag?.preview; }
  get needsRecovery(): boolean { return this.recovery !== null; }
  get guides() { return this.icon ? gridGuides(this.icon.viewBox, [1, 1]) : null; }
  get styleableSelection(): boolean {
    const selectedIds = this.selection.snapshot.nodeIds;
    if (selectedIds.length !== 1) return false;
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
    const node = find(this.icon?.nodes ?? []);
    return Boolean(node && !node.locked && (node.type === 'rect' || node.type === 'ellipse'
      || node.type === 'path' || node.type === 'polyline'));
  }

  private base(projectId: string) {
    return { commandVersion: '1.0' as const, commandId: uuidV7(), projectId,
      expectedRevision: this.dispatcher.revision, issuedAt: new Date().toISOString(), actor: { kind: 'user' as const } };
  }

  private async openLock(projectId: string): Promise<void> {
    this.unsubscribeMode?.();
    await this.lock?.close();
    this.lock = await ProjectWriteLock.open(projectId, async () => { await this.pendingSave; });
    this.unsubscribeMode = this.lock.onModeChange(mode => {
      if (!this.recovery) this.saveStatus = mode === 'writer' ? 'Saved in browser only' : 'Read only in this tab';
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
  }

  private loadRow(row: NonNullable<Awaited<ReturnType<DexieProjectRepository['load']>>>): void {
    this.dispatcher = ProjectDispatcher.replay(row.snapshot, row.journal);
    this.currentIconId = this.project?.icons.find(icon => icon.id === this.currentIconId)?.id
      ?? this.project?.icons[0]?.id ?? null;
    if (this.project) this.selection.reconcile(this.project);
    if (this.dispatcher.recoveryDiagnostics.length) {
      this.recovery = { projectId: row.id, storedRevision: row.revision,
        validLength: this.dispatcher.revision - (row.snapshot?.revision ?? 0) };
      this.error = 'A damaged journal tail was found. Recover valid edits to continue.';
      this.saveStatus = 'Recovery needed';
      return;
    }
    this.recovery = null;
    this.error = '';
    this.saveStatus = this.writable ? 'Saved in browser only' : 'Read only in this tab';
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
    await this.repository.truncateJournal(damaged.projectId, damaged.storedRevision, damaged.validLength);
    this.recovery = null;
    this.error = '';
    this.saveStatus = 'Recovered valid edits';
    this.lock!.publishRevision(this.dispatcher.revision);
  }

  private async persist(command: CommandEnvelopeV1): Promise<void> {
    if (!this.writable || this.recovery) throw new TypeError('Project is read only until recovery is complete');
    const before = this.dispatcher.revision;
    this.dispatcher.dispatch(command);
    const entry = this.dispatcher.journal.at(-1)!;
    const write = this.repository.append(command.projectId, before, this.dispatcher.revision, entry);
    this.pendingSave = write;
    try {
      await write;
      if (this.lock?.mode === 'writer') this.lock.publishRevision(this.dispatcher.revision);
      this.saveStatus = 'Saved in browser only';
      this.error = '';
      if (this.project) this.selection.reconcile(this.project);
    } catch (error) {
      const row = await this.repository.load(command.projectId);
      this.dispatcher = row ? ProjectDispatcher.replay(row.snapshot, row.journal) : new ProjectDispatcher();
      this.error = error instanceof Error ? error.message : String(error);
      this.saveStatus = 'Save failed';
      throw error;
    } finally {
      if (this.pendingSave === write) this.pendingSave = null;
    }
  }

  async create(): Promise<void> {
    const id = uuidV7();
    await this.openLock(id);
    this.dispatcher = new ProjectDispatcher();
    this.recovery = null;
    this.selection.clear();
    this.currentIconId = null;
    await this.persist({ ...this.base(id), type: 'project.create', payload: { id, name: 'Untitled project' } });
    localStorage.setItem(POINTER, id);
    void requestPersistentStorage();
    await this.persist({ ...this.base(id), type: 'exportProfile.upsert',
      payload: { profile: { id: uuidV7(), name: 'web-svg', target: 'svg',
        options: { precision: 3, sizeAttrs: true, paintMode: 'currentColor', metadata: false } } } });
  }

  async addIcon(): Promise<void> {
    const project = this.project;
    if (!project) throw new TypeError('Create a project first');
    let index = 1;
    while (project.icons.some(icon => icon.name === `icon-${index}`)) index++;
    const icon: IconV1 = { id: uuidV7(), name: `icon-${index}`, aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], nodes: [], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [] };
    await this.persist({ ...this.base(project.id), type: 'icon.add', payload: { icon } });
    this.currentIconId = icon.id;
    this.selection.clear();
  }

  async addRectangle(): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    if (!project || !icon) throw new TypeError('Add an icon first');
    const node: SceneNodeV1 = { id: uuidV7(), type: 'rect', visible: true, locked: false,
      x: 4, y: 4, width: 16, height: 16, rx: 0, ry: 0, fill: { kind: 'token', token: 'currentColor' } };
    await this.persist({ ...this.base(project.id), type: 'node.add',
      payload: { iconId: icon.id, index: icon.nodes.length, node } });
  }

  async addEllipse(): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    if (!project || !icon) throw new TypeError('Add an icon first');
    const node: SceneNodeV1 = { id: uuidV7(), type: 'ellipse', visible: true, locked: false,
      cx: 12, cy: 12, rx: 8, ry: 8, fill: { kind: 'token', token: 'currentColor' } };
    await this.persist({ ...this.base(project.id), type: 'node.add',
      payload: { iconId: icon.id, index: icon.nodes.length, node } });
  }

  async addLine(): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    if (!project || !icon) throw new TypeError('Add an icon first');
    const node: SceneNodeV1 = { id: uuidV7(), type: 'line', visible: true, locked: false,
      x1: 4, y1: 20, x2: 20, y2: 4,
      stroke: { paint: { kind: 'token', token: 'currentColor' }, width: 1.75,
        cap: 'round', join: 'round', miterLimit: 4 } };
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
    const before = this.dispatcher.revision;
    if (!gesture.commit()) return;
    const entry = this.dispatcher.journal.at(-1)!;
    const write = this.repository.append(projectId, before, this.dispatcher.revision, entry);
    this.pendingSave = write;
    try {
      await write;
      if (this.lock?.mode === 'writer') this.lock.publishRevision(this.dispatcher.revision);
      this.saveStatus = 'Saved in browser only';
      this.error = '';
    } catch (error) {
      const row = await this.repository.load(projectId);
      this.dispatcher = row ? ProjectDispatcher.replay(row.snapshot, row.journal) : new ProjectDispatcher();
      throw error;
    } finally {
      if (this.pendingSave === write) this.pendingSave = null;
    }
  }

  async finishDrag(): Promise<void> {
    const gesture = this.drag;
    this.drag = null;
    const id = this.project?.id;
    if (gesture && id) await this.commitGesture(gesture, id);
  }

  async moveRight(): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    const nodeIds = this.selection.snapshot.nodeIds;
    if (!project || !icon || !nodeIds.length || !this.writable) return;
    const gesture = new TransformGesture(this.dispatcher, { ...this.base(project.id), iconId: icon.id, nodeIds });
    gesture.update([1, 0, 0, 1, 1, 0]);
    await this.commitGesture(gesture, project.id);
  }

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

  async close(): Promise<void> {
    await this.pendingSave;
    this.unsubscribeMode?.();
    await this.lock?.close();
    this.repository.close();
  }
}
