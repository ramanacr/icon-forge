import { ProjectDispatcher } from '@iconforge/application';
import type { CommandEnvelopeV1 } from '@iconforge/commands';
import { compileSvgProfile } from '@iconforge/compiler-core';
import { SelectionModel, TransformGesture } from '@iconforge/editor-core';
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
  private pendingSave: Promise<void> | null = null;
  readonly selection = new SelectionModel();
  currentIconId: string | null = null;
  saveStatus = '';
  error = '';

  get project(): ProjectV1 | null { return this.dispatcher.project; }
  get writable(): boolean { return this.lock?.mode === 'writer'; }
  get icon(): IconV1 | null { return this.project?.icons.find(icon => icon.id === this.currentIconId) ?? null; }

  private base(projectId: string) {
    return { commandVersion: '1.0' as const, commandId: uuidV7(), projectId,
      expectedRevision: this.dispatcher.revision, issuedAt: new Date().toISOString(), actor: { kind: 'user' as const } };
  }

  private async openLock(projectId: string): Promise<void> {
    await this.lock?.close();
    this.lock = await ProjectWriteLock.open(projectId, async () => { await this.pendingSave; });
  }

  async openLast(): Promise<void> {
    const id = localStorage.getItem(POINTER);
    if (!id) return;
    const row = await this.repository.load(id);
    if (!row) { localStorage.removeItem(POINTER); return; }
    this.dispatcher = ProjectDispatcher.replay(row.snapshot, row.journal);
    if (this.dispatcher.recoveryDiagnostics.length) {
      this.error = 'A damaged edit was found. Open a recovered copy before editing.';
      this.saveStatus = 'Recovery needed';
      return;
    }
    await this.openLock(id);
    this.currentIconId = this.project?.icons[0]?.id ?? null;
    this.saveStatus = this.writable ? 'Saved in browser only' : 'Read only in this tab';
  }

  private async persist(command: CommandEnvelopeV1): Promise<void> {
    if (!this.writable) throw new TypeError('Project is read only in this tab');
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

  select(nodeId: string): void {
    const project = this.project;
    const icon = this.icon;
    if (project && icon) this.selection.replace(project, icon.id, [nodeId]);
  }

  async moveRight(): Promise<void> {
    const project = this.project;
    const icon = this.icon;
    const nodeIds = this.selection.snapshot.nodeIds;
    if (!project || !icon || !nodeIds.length || !this.writable) return;
    const gesture = new TransformGesture(this.dispatcher, { ...this.base(project.id), iconId: icon.id, nodeIds });
    gesture.update([1, 0, 0, 1, 1, 0]);
    const before = this.dispatcher.revision;
    gesture.commit();
    const entry = this.dispatcher.journal.at(-1)!;
    const write = this.repository.append(project.id, before, this.dispatcher.revision, entry);
    this.pendingSave = write;
    try {
      await write;
      if (this.lock?.mode === 'writer') this.lock.publishRevision(this.dispatcher.revision);
      this.saveStatus = 'Saved in browser only';
    } catch (error) {
      const row = await this.repository.load(project.id);
      this.dispatcher = row ? ProjectDispatcher.replay(row.snapshot, row.journal) : new ProjectDispatcher();
      throw error;
    } finally {
      if (this.pendingSave === write) this.pendingSave = null;
    }
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

  async close(): Promise<void> { await this.pendingSave; await this.lock?.close(); this.repository.close(); }
}
