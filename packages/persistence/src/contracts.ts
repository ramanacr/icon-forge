import type { DispatcherCheckpoint, JournalEntry } from '@iconforge/application';
import type { ProjectV1 } from '@iconforge/project-model';

export interface SavedProject {
  id: string;
  revision: number;
  snapshot: ProjectV1 | null;
  journal: JournalEntry[];
  checkpoint?: DispatcherCheckpoint;
}

export interface IProjectRepository {
  load(id: string): Promise<SavedProject | null>;
  append(id: string, expectedRevision: number, nextRevision: number, entry: JournalEntry): Promise<void>;
  appendImport(id: string, expectedRevision: number, nextRevision: number, entry: JournalEntry, originalSvg: Uint8Array): Promise<void>;
  loadOriginals(id: string): Promise<Record<string, Uint8Array>>;
  compact(id: string, expectedRevision: number, snapshot: ProjectV1, checkpoint?: DispatcherCheckpoint): Promise<void>;
  truncateJournal(id: string, expectedRevision: number, validLength: number): Promise<void>;
  insertSnapshot(snapshot: ProjectV1): Promise<void>;
}
