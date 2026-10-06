import { Dexie, type Table } from 'dexie';
import { assertProject, type ProjectV1 } from '@iconforge/project-model';
import { ProjectDispatcher, type DispatcherCheckpoint, type JournalEntry } from '@iconforge/application';
import type { IProjectRepository, SavedProject } from './contracts.js';
import { asProjectStorageError } from './storage-error.js';

class ProjectDatabase extends Dexie {
  projects!: Table<SavedProject, string>;
  originals!: Table<{ key: string; projectId: string; path: string; bytes: Uint8Array }, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ projects: 'id' });
    this.version(2).stores({ projects: 'id', originals: 'key, projectId' });
  }
}

/** Atomic IndexedDB snapshot/journal storage. The application owns replay and history. */
export class DexieProjectRepository implements IProjectRepository {
  private readonly database: ProjectDatabase;

  constructor(databaseName: string) {
    this.database = new ProjectDatabase(databaseName);
  }

  async load(id: string): Promise<SavedProject | null> {
    const row = await this.database.projects.get(id);
    return row ? structuredClone(row) : null;
  }

  async append(id: string, expectedRevision: number, nextRevision: number, entry: JournalEntry): Promise<void> {
    if (entry.command.type === 'icon.importSvg') throw new TypeError('journal.append.original-required');
    await this.appendEntry(id, expectedRevision, nextRevision, entry);
  }

  async appendImport(id: string, expectedRevision: number, nextRevision: number,
    entry: JournalEntry, originalSvg: Uint8Array): Promise<void> {
    if (entry.command.type !== 'icon.importSvg' || !(originalSvg instanceof Uint8Array)
      || originalSvg.length > 2 * 1024 * 1024) throw new TypeError('journal.append.invalid-original');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(originalSvg))),
      byte => byte.toString(16).padStart(2, '0')).join('');
    if (entry.command.payload.provenance.originalSha256 !== hash) {
      throw new TypeError('journal.append.original-hash-mismatch');
    }
    await this.appendEntry(id, expectedRevision, nextRevision, entry,
      { key: `${id}/originals/${hash}.svg`, projectId: id, path: `originals/${hash}.svg`, bytes: new Uint8Array(originalSvg) });
  }

  async loadOriginals(id: string): Promise<Record<string, Uint8Array>> {
    const rows = await this.database.originals.where('projectId').equals(id).toArray();
    return Object.fromEntries(rows.map(row => [row.path, new Uint8Array(row.bytes)]));
  }

  private async appendEntry(id: string, expectedRevision: number, nextRevision: number,
    entry: JournalEntry, original?: { key: string; projectId: string; path: string; bytes: Uint8Array }): Promise<void> {
    if (nextRevision !== expectedRevision + 1 || entry.command.projectId !== id || entry.command.dryRun) {
      throw new TypeError('journal.append.invalid');
    }
    try {
      await this.database.transaction('rw', this.database.projects, this.database.originals, async () => {
        const row = await this.database.projects.get(id);
        const revision = row?.revision ?? 0;
        if (revision !== expectedRevision) throw new TypeError('revision.conflict');
        const next: SavedProject = row
          ? { ...row, revision: nextRevision, journal: [...row.journal, structuredClone(entry)] }
          : { id, revision: nextRevision, snapshot: null, journal: [structuredClone(entry)] };
        await this.database.projects.put(next);
        if (original) await this.database.originals.put(original);
      });
    } catch (error) { throw asProjectStorageError(error); }
  }

  async compact(id: string, expectedRevision: number, snapshot: ProjectV1,
    checkpoint?: DispatcherCheckpoint): Promise<void> {
    assertProject(snapshot);
    if (snapshot.id !== id || snapshot.revision !== expectedRevision) throw new TypeError('snapshot.invalid');
    if (checkpoint) new ProjectDispatcher(snapshot, checkpoint);
    try {
      await this.database.transaction('rw', this.database.projects, async () => {
        const row = await this.database.projects.get(id);
        if (!row || row.revision !== expectedRevision) throw new TypeError('revision.conflict');
        await this.database.projects.put({ id, revision: expectedRevision,
          snapshot: structuredClone(snapshot), journal: [], ...(checkpoint ? { checkpoint: structuredClone(checkpoint) } : {}) });
      });
    } catch (error) { throw asProjectStorageError(error); }
  }

  async truncateJournal(id: string, expectedRevision: number, validLength: number): Promise<void> {
    if (!Number.isSafeInteger(validLength) || validLength < 0) throw new TypeError('journal.length.invalid');
    try {
      await this.database.transaction('rw', this.database.projects, async () => {
        const row = await this.database.projects.get(id);
        if (!row || row.revision !== expectedRevision) throw new TypeError('revision.conflict');
        const baseRevision = row.snapshot?.revision ?? 0;
        if (baseRevision + row.journal.length !== row.revision || validLength > row.journal.length) {
          throw new TypeError('journal.length.invalid');
        }
        await this.database.projects.put({ ...row, revision: baseRevision + validLength,
          journal: row.journal.slice(0, validLength) });
      });
    } catch (error) { throw asProjectStorageError(error); }
  }

  async insertSnapshot(snapshot: ProjectV1): Promise<void> {
    assertProject(snapshot);
    try {
      await this.database.transaction('rw', this.database.projects, async () => {
        if (await this.database.projects.get(snapshot.id)) throw new TypeError('snapshot.exists');
        await this.database.projects.add({ id: snapshot.id, revision: snapshot.revision,
          snapshot: structuredClone(snapshot), journal: [] });
      });
    } catch (error) { throw asProjectStorageError(error); }
  }

  close(): void { this.database.close(); }
}
