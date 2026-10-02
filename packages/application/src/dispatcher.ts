import { assertProject, canonicalJson, type ProjectV1 } from '@iconforge/project-model';
import { applyProjectCommand, assertProjectCommand, type HandlerResult, type ProjectCommand } from '@iconforge/commands';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

type CommandResult = HandlerResult['result'];
export interface JournalEntry { command: ProjectCommand; checksum: string }
export interface RecoveryDiagnostic { severity: 'warning'; code: 'journal.corrupt-tail'; message: string }

function checksum(command: ProjectCommand): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(command))));
}

/** In-memory application boundary; repository adapters persist snapshots and journal. */
export class ProjectDispatcher {
  private current: ProjectV1 | null;
  private readonly entries: JournalEntry[] = [];
  private readonly results = new Map<string, CommandResult>();
  readonly recoveryDiagnostics: RecoveryDiagnostic[] = [];

  constructor(snapshot: ProjectV1 | null = null) {
    this.current = snapshot === null ? null : assertProject(structuredClone(snapshot));
  }

  get project(): ProjectV1 | null { return this.current === null ? null : structuredClone(this.current); }
  get journal(): readonly JournalEntry[] { return structuredClone(this.entries); }

  dispatch(command: ProjectCommand): CommandResult {
    assertProjectCommand(command);
    if (!command.dryRun) {
      const previous = this.results.get(command.commandId);
      if (previous) return structuredClone(previous);
    }
    const applied = applyProjectCommand(this.current, command);
    if (command.dryRun) {
      return { ...applied.result, revision: this.current?.revision ?? 0, status: 'dry-run' };
    }
    this.current = applied.project;
    const snapshot = structuredClone(command);
    this.entries.push({ command: snapshot, checksum: checksum(snapshot) });
    this.results.set(command.commandId, structuredClone(applied.result));
    return structuredClone(applied.result);
  }

  static replay(snapshot: ProjectV1 | null, journal: readonly JournalEntry[]): ProjectDispatcher {
    const dispatcher = new ProjectDispatcher(snapshot);
    for (const [index, entry] of journal.entries()) {
      try {
        if (checksum(entry.command) !== entry.checksum) throw new TypeError('Checksum mismatch');
        dispatcher.dispatch(entry.command);
      } catch {
        dispatcher.recoveryDiagnostics.push({ severity: 'warning', code: 'journal.corrupt-tail', message: `Journal truncated at entry ${index}` });
        break;
      }
    }
    return dispatcher;
  }
}
