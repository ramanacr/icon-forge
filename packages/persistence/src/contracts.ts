import type { JournalEntry } from '@iconforge/application';
import type { ProjectV1 } from '@iconforge/project-model';

export interface SavedProject {
  id: string;
  revision: number;
  snapshot: ProjectV1 | null;
  journal: JournalEntry[];
}

export interface IProjectRepository {
  load(id: string): Promise<SavedProject | null>;
  append(id: string, expectedRevision: number, nextRevision: number, entry: JournalEntry): Promise<void>;
  compact(id: string, expectedRevision: number, snapshot: ProjectV1): Promise<void>;
}
