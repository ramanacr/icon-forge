import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@iconforge/project-model';
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
});
