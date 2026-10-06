import { assertProject, canonicalJson, type ProjectV1 } from '@iconforge/project-model';
import { applyProjectCommand, assertCommandEnvelope, type CommandEnvelopeV1, type HandlerResult, type StructuralPatch } from '@iconforge/commands';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { applyPatches } from './patches.js';

export type CommandResult = HandlerResult['result'];
export interface Transaction { patches: StructuralPatch[]; inversePatches: StructuralPatch[] }
export interface DispatcherCheckpoint {
  revision: number;
  projectHash: string;
  undo: Transaction[];
  redo: Transaction[];
  results: [string, CommandResult][];
  checksum: string;
}
export interface JournalEntry {
  command: CommandEnvelopeV1;
  patches: StructuralPatch[];
  inversePatches: StructuralPatch[];
  checksum: string;
}
export interface RecoveryDiagnostic { severity: 'warning'; code: 'journal.corrupt-tail'; message: string }

function hashCanonical(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value))));
}

function checksum(entry: Omit<JournalEntry, 'checksum'>): string {
  return hashCanonical(entry);
}

/** In-memory application boundary; repository adapters persist snapshots and journal. */
export class ProjectDispatcher {
  private current: ProjectV1 | null;
  private currentRevision: number;
  private readonly entries: JournalEntry[] = [];
  private readonly results = new Map<string, CommandResult>();
  private readonly undoStack: Transaction[] = [];
  private readonly redoStack: Transaction[] = [];
  readonly recoveryDiagnostics: RecoveryDiagnostic[] = [];

  constructor(snapshot: ProjectV1 | null = null, checkpoint?: DispatcherCheckpoint) {
    this.current = snapshot === null ? null : assertProject(structuredClone(snapshot));
    this.currentRevision = snapshot?.revision ?? 0;
    if (checkpoint) {
      const { checksum: storedChecksum, ...payload } = checkpoint;
      if (!snapshot || checkpoint.revision !== snapshot.revision
        || checkpoint.projectHash !== hashCanonical(snapshot)
        || !Array.isArray(checkpoint.undo) || !Array.isArray(checkpoint.redo)
        || !Array.isArray(checkpoint.results) || hashCanonical(payload) !== storedChecksum) {
        throw new TypeError('checkpoint.invalid');
      }
      const keys = new Set<string>();
      for (const [id, result] of checkpoint.results) {
        if (keys.has(id) || result.commandId !== id) throw new TypeError('checkpoint.invalid');
        keys.add(id);
        this.results.set(id, structuredClone(result));
      }
      this.undoStack.push(...structuredClone(checkpoint.undo));
      this.redoStack.push(...structuredClone(checkpoint.redo));
    }
  }

  get project(): ProjectV1 | null { return this.current === null ? null : structuredClone(this.current); }
  get journal(): readonly JournalEntry[] { return structuredClone(this.entries); }
  get journalLength(): number { return this.entries.length; }
  get revision(): number { return this.currentRevision; }

  checkpoint(): DispatcherCheckpoint {
    if (!this.current) throw new TypeError('checkpoint.no-project');
    const payload = { revision: this.currentRevision, projectHash: hashCanonical(this.current),
      undo: structuredClone(this.undoStack), redo: structuredClone(this.redoStack),
      results: structuredClone([...this.results]) };
    return { ...payload, checksum: hashCanonical(payload) };
  }

  dispatch(command: CommandEnvelopeV1): CommandResult {
    assertCommandEnvelope(command);
    if (!command.dryRun) {
      const previous = this.results.get(command.commandId);
      if (previous) return structuredClone(previous);
    }
    if (command.expectedRevision !== undefined && command.expectedRevision !== this.currentRevision) {
      throw new TypeError('revision.conflict');
    }
    if (command.type === 'history.undo' || command.type === 'history.redo') {
      const undo = command.type === 'history.undo';
      const source = undo ? this.undoStack : this.redoStack;
      const destination = undo ? this.redoStack : this.undoStack;
      const transaction = source.at(-1);
      if (!transaction) throw new TypeError('history.empty');
      const patches = undo ? transaction.inversePatches : transaction.patches;
      const changed = applyPatches(this.current, patches);
      const result: CommandResult = {
        commandId: command.commandId, status: command.dryRun ? 'dry-run' : 'applied',
        revision: command.dryRun ? this.currentRevision : this.currentRevision + 1,
        changedIds: [command.projectId],
        patchSummary: { added: this.current === null && changed !== null ? 1 : 0,
          updated: this.current !== null && changed !== null ? 1 : 0,
          removed: this.current !== null && changed === null ? 1 : 0, iconsAffected: [] },
        diagnostics: [],
      };
      if (!command.dryRun) {
        this.currentRevision++;
        this.current = changed === null ? null : assertProject({ ...changed, revision: this.currentRevision });
        source.pop();
        destination.push(transaction);
        this.record(command, result, patches, undo ? transaction.patches : transaction.inversePatches);
      }
      return structuredClone(result);
    }
    const applied = applyProjectCommand(this.current, command);
    if (command.dryRun) {
      return { ...applied.result, revision: this.currentRevision, status: 'dry-run' };
    }
    this.currentRevision++;
    this.current = assertProject({ ...applied.project, revision: this.currentRevision });
    const transaction = { patches: applied.patches, inversePatches: applied.inversePatches };
    this.undoStack.push(transaction);
    this.redoStack.length = 0;
    const result = { ...applied.result, revision: this.currentRevision };
    this.record(command, result, applied.patches, applied.inversePatches);
    return structuredClone(result);
  }

  private record(command: CommandEnvelopeV1, result: CommandResult, patches: StructuralPatch[], inversePatches: StructuralPatch[]): void {
    const entry = structuredClone({ command, patches, inversePatches });
    this.entries.push({ ...entry, checksum: checksum(entry) });
    this.results.set(command.commandId, structuredClone(result));
  }

  static replay(snapshot: ProjectV1 | null, journal: readonly JournalEntry[],
    checkpoint?: DispatcherCheckpoint): ProjectDispatcher {
    const dispatcher = new ProjectDispatcher(snapshot, checkpoint);
    for (const [index, entry] of journal.entries()) {
      try {
        const { checksum: storedChecksum, ...payload } = entry;
        if (checksum(payload) !== storedChecksum) throw new TypeError('Checksum mismatch');
        dispatcher.dispatch(entry.command);
        const generated = dispatcher.entries.at(-1)!;
        if (canonicalJson(generated.patches) !== canonicalJson(entry.patches)
          || canonicalJson(generated.inversePatches) !== canonicalJson(entry.inversePatches)) {
          throw new TypeError('Journal patch mismatch');
        }
      } catch {
        const recovered = ProjectDispatcher.replay(snapshot, journal.slice(0, index), checkpoint);
        recovered.recoveryDiagnostics.push({ severity: 'warning', code: 'journal.corrupt-tail', message: `Journal truncated at entry ${index}` });
        return recovered;
      }
    }
    return dispatcher;
  }
}
