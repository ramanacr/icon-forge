import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@iconforge/project-model';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ProjectDispatcher } from './dispatcher.js';

const id = '0198e09b-a810-7000-8000-000000000001';
const firstId = '0198e09b-a810-7000-8000-000000000002';
const secondId = '0198e09b-a810-7000-8000-000000000003';
const base = { commandVersion: '1.0' as const, projectId: id, issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' as const } };
const create = { ...base, commandId: firstId, type: 'project.create' as const, payload: { id, name: 'Medical' } };
const rename = { ...base, commandId: secondId, type: 'project.rename' as const, payload: { name: 'Clinical' }, expectedRevision: 1 };

describe('project dispatcher', () => {
  it('does not commit a dry-run and applies the confirmed command once', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const dryRun = dispatcher.dispatch({ ...rename, dryRun: true });
    expect(dryRun.status).toBe('dry-run');
    expect(dryRun.revision).toBe(1);
    expect(dispatcher.project?.name).toBe('Medical');
    expect(dispatcher.journal).toHaveLength(1);
    const applied = dispatcher.dispatch(rename);
    expect(applied.status).toBe('applied');
    expect(dispatcher.project?.name).toBe('Clinical');
    expect(dispatcher.journal).toHaveLength(2);
    expect(dispatcher.dispatch(rename)).toEqual(applied);
    expect(dispatcher.journal).toHaveLength(2);
  });

  it('replays the journal to identical project bytes', () => {
    const original = new ProjectDispatcher();
    original.dispatch(create);
    original.dispatch(rename);
    const replayed = ProjectDispatcher.replay(null, original.journal);
    expect(canonicalJson(replayed.project)).toBe(canonicalJson(original.project));
    expect(original.journal[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(original.journal[1]?.patches).toEqual([{ op: 'replace', path: ['name'], before: 'Medical', after: 'Clinical' }]);
    expect(original.journal[1]?.inversePatches).toEqual([{ op: 'replace', path: ['name'], before: 'Clinical', after: 'Medical' }]);
  });

  it('truncates and reports a corrupt journal tail', () => {
    const original = new ProjectDispatcher();
    original.dispatch(create);
    original.dispatch(rename);
    const corrupted = original.journal.map(entry => ({ ...entry }));
    corrupted[1]!.checksum = '0'.repeat(64);
    const recovered = ProjectDispatcher.replay(null, corrupted);
    expect(recovered.project?.name).toBe('Medical');
    expect(recovered.journal).toHaveLength(1);
    expect(recovered.recoveryDiagnostics.map(diagnostic => diagnostic.code)).toEqual(['journal.corrupt-tail']);
  });

  it('rejects journal patches that do not match command replay even with a matching checksum', () => {
    const original = new ProjectDispatcher();
    original.dispatch(create);
    original.dispatch(rename);
    const tampered = structuredClone(original.journal);
    tampered[1]!.patches[0]!.after = 'Tampered';
    const { checksum: _old, ...payload } = tampered[1]!;
    tampered[1]!.checksum = bytesToHex(sha256(new TextEncoder().encode(canonicalJson(payload))));
    const recovered = ProjectDispatcher.replay(null, tampered);
    expect(recovered.project?.name).toBe('Medical');
    expect(recovered.journal).toHaveLength(1);
    expect(recovered.recoveryDiagnostics[0]?.code).toBe('journal.corrupt-tail');
  });

  it('rejects unknown command properties before mutation', () => {
    const dispatcher = new ProjectDispatcher();
    expect(() => dispatcher.dispatch({ ...create, unexpected: true } as typeof create)).toThrow();
    expect(dispatcher.project).toBeNull();
  });

  it('does not expose mutable authoritative state or journal entries', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const viewed = dispatcher.project!;
    viewed.name = 'Tampered';
    const entries = dispatcher.journal as unknown as { command: { payload: { name: string } } }[];
    entries[0]!.command.payload.name = 'Tampered';
    expect(dispatcher.project?.name).toBe('Medical');
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project?.name).toBe('Medical');
  });

  it('undoes and redoes a rename as revisioned transactions', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    dispatcher.dispatch(rename);
    const undo = { ...base, commandId: '0198e09b-a810-7000-8000-000000000004', type: 'history.undo' as const, payload: {}, expectedRevision: 2 };
    const redo = { ...base, commandId: '0198e09b-a810-7000-8000-000000000005', type: 'history.redo' as const, payload: {}, expectedRevision: 3 };
    expect(dispatcher.dispatch(undo).revision).toBe(3);
    expect(dispatcher.project?.name).toBe('Medical');
    expect(dispatcher.project?.revision).toBe(3);
    expect(dispatcher.dispatch(redo).revision).toBe(4);
    expect(dispatcher.project?.name).toBe('Clinical');
    expect(canonicalJson(ProjectDispatcher.replay(null, dispatcher.journal).project)).toBe(canonicalJson(dispatcher.project));
  });

  it('can undo creation and redo it without reusing a revision', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const undo = { ...base, commandId: '0198e09b-a810-7000-8000-000000000004', type: 'history.undo' as const, payload: {}, expectedRevision: 1 };
    const redo = { ...base, commandId: '0198e09b-a810-7000-8000-000000000005', type: 'history.redo' as const, payload: {}, expectedRevision: 2 };
    dispatcher.dispatch(undo);
    expect(dispatcher.project).toBeNull();
    expect(dispatcher.revision).toBe(2);
    dispatcher.dispatch(redo);
    expect(dispatcher.project?.revision).toBe(3);
    expect(canonicalJson(ProjectDispatcher.replay(null, dispatcher.journal).project)).toBe(canonicalJson(dispatcher.project));
  });

  it('keeps a dry-run undo out of history and clears redo after a new edit', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    dispatcher.dispatch(rename);
    const undo = { ...base, commandId: '0198e09b-a810-7000-8000-000000000004', type: 'history.undo' as const, payload: {}, expectedRevision: 2 };
    expect(dispatcher.dispatch({ ...undo, dryRun: true }).revision).toBe(2);
    expect(dispatcher.project?.name).toBe('Clinical');
    expect(dispatcher.journal).toHaveLength(2);
    dispatcher.dispatch(undo);
    dispatcher.dispatch({ ...rename, commandId: '0198e09b-a810-7000-8000-000000000006', payload: { name: 'Care' }, expectedRevision: 3 });
    expect(() => dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000007', type: 'history.redo', payload: {} })).toThrow('history.empty');
  });

  it.each([1, 200, 5_000])('replays %i rename commands byte-for-byte', count => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    for (let index = 0; index < count; index++) {
      dispatcher.dispatch({ ...base,
        commandId: `0198e09b-a810-7000-8000-${(index + 10).toString(16).padStart(12, '0')}`,
        type: 'project.rename', payload: { name: `Name ${index}` }, expectedRevision: index + 1,
      });
    }
    const recovered = ProjectDispatcher.replay(null, dispatcher.journal);
    expect(recovered.recoveryDiagnostics).toEqual([]);
    expect(canonicalJson(recovered.project)).toBe(canonicalJson(dispatcher.project));
  });
});
