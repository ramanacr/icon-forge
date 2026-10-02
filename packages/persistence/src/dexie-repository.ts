import { Dexie, type Table } from 'dexie';
import { assertProject, type ProjectV1 } from '@iconforge/project-model';
import type { JournalEntry } from '@iconforge/application';
import type { IProjectRepository, SavedProject } from './contracts.js';

class ProjectDatabase extends Dexie {
  projects!: Table<SavedProject, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ projects: 'id' });
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
    if (nextRevision !== expectedRevision + 1 || entry.command.projectId !== id || entry.command.dryRun) {
      throw new TypeError('journal.append.invalid');
    }
    await this.database.transaction('rw', this.database.projects, async () => {
      const row = await this.database.projects.get(id);
      const revision = row?.revision ?? 0;
      if (revision !== expectedRevision) throw new TypeError('revision.conflict');
      const next: SavedProject = row
        ? { ...row, revision: nextRevision, journal: [...row.journal, structuredClone(entry)] }
        : { id, revision: nextRevision, snapshot: null, journal: [structuredClone(entry)] };
      await this.database.projects.put(next);
    });
  }

  async compact(id: string, expectedRevision: number, snapshot: ProjectV1): Promise<void> {
    assertProject(snapshot);
    if (snapshot.id !== id || snapshot.revision !== expectedRevision) throw new TypeError('snapshot.invalid');
    await this.database.transaction('rw', this.database.projects, async () => {
      const row = await this.database.projects.get(id);
      if (!row || row.revision !== expectedRevision) throw new TypeError('revision.conflict');
      await this.database.projects.put({ id, revision: expectedRevision, snapshot: structuredClone(snapshot), journal: [] });
    });
  }

  close(): void { this.database.close(); }
}
