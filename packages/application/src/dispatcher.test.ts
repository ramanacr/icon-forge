import { describe, expect, it } from 'vitest';
import { canonicalJson, type IconV1 } from '@iconforge/project-model';
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
  it('imports a canonical icon and provenance as one reversible replayable command', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const provenance = { id: '0198e09b-a810-7000-8000-0000000000b1',
      originalSha256: 'a'.repeat(64), modified: false };
    const icon: IconV1 = { id: '0198e09b-a810-7000-8000-0000000000b2', name: 'imported',
      aliases: [], tags: [], viewBox: [0, 0, 24, 24], nodes: [], variants: [],
      accessibility: { kind: 'decorative' }, provenanceIds: [provenance.id] };
    const importCommand = { ...base, commandId: '0198e09b-a810-7000-8000-0000000000b3',
      type: 'icon.importSvg' as const, payload: { icon, provenance,
        diagnostics: [{ code: 'svg.unsupported-attribute', severity: 'warning' as const, message: 'Ignored metadata' }] } };
    expect(dispatcher.dispatch(importCommand).diagnostics).toEqual(importCommand.payload.diagnostics);
    expect(dispatcher.project?.provenance).toEqual([provenance]);
    expect(dispatcher.project?.icons).toEqual([icon]);
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project).toEqual(dispatcher.project);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000b4', type: 'history.undo', payload: {} });
    expect(dispatcher.project?.provenance).toEqual([]);
    expect(dispatcher.project?.icons).toEqual([]);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000b5', type: 'history.redo', payload: {} });
    expect(dispatcher.project?.provenance).toEqual([provenance]);
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project).toEqual(dispatcher.project);
    expect(() => dispatcher.dispatch({ ...importCommand, commandId: '0198e09b-a810-7000-8000-0000000000b6',
      payload: { ...importCommand.payload, icon: { ...icon, provenanceIds: [] } } }))
      .toThrow('icon.importSvg.invalid-payload');
  });
  it('undoes and replays sibling grouping and ungrouping as single transactions', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const groupId = '0198e09b-a810-7000-8000-0000000000d0';
    const nodes: IconV1['nodes'] = [0xd1, 0xd2, 0xd3].map((number, index) => ({
      id: `0198e09b-a810-7000-8000-${number.toString(16).padStart(12, '0')}`,
      type: 'rect', visible: true, locked: false, x: index * 4, y: 0, width: 2, height: 2, rx: 0, ry: 0,
    }));
    const icon: IconV1 = { id: '0198e09b-a810-7000-8000-0000000000d4', name: 'boxes', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [], nodes };
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000d5',
      type: 'icon.add', payload: { icon } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000d6',
      type: 'node.group', payload: { iconId: icon.id, nodeIds: [nodes[2]!.id, nodes[0]!.id], groupId, index: 1 } });
    expect(dispatcher.project?.icons[0]?.nodes[1]).toMatchObject({ type: 'group', children: [nodes[0], nodes[2]] });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000d7',
      type: 'history.undo', payload: {} });
    expect(dispatcher.project?.icons[0]).toEqual(icon);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000d8',
      type: 'history.redo', payload: {} });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000d9',
      type: 'node.ungroup', payload: { iconId: icon.id, groupId } });
    expect(dispatcher.project?.icons[0]?.nodes.map(node => node.id)).toEqual([nodes[1]!.id, nodes[0]!.id, nodes[2]!.id]);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000da',
      type: 'history.undo', payload: {} });
    expect(dispatcher.project?.icons[0]?.nodes[1]).toMatchObject({ type: 'group', children: [nodes[0], nodes[2]] });
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project).toEqual(dispatcher.project);
  });
  it('undoes and replays a node reorder across sibling arrays', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const groupId = '0198e09b-a810-7000-8000-0000000000f1';
    const leafId = '0198e09b-a810-7000-8000-0000000000f2';
    const leaf: IconV1['nodes'][number] = { id: leafId, type: 'rect', visible: true, locked: false,
      x: 0, y: 0, width: 8, height: 8, rx: 0, ry: 0 };
    const icon: IconV1 = { id: '0198e09b-a810-7000-8000-0000000000f0', name: 'box', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [],
      nodes: [leaf, { id: groupId, type: 'group', visible: true, locked: false, children: [] }] };
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000f3',
      type: 'icon.add', payload: { icon } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000f4',
      type: 'node.reorder', payload: { iconId: icon.id, nodeId: leafId, parentId: groupId, index: 0 } });
    expect(dispatcher.project?.icons[0]?.nodes).toHaveLength(1);
    const group = dispatcher.project?.icons[0]?.nodes[0];
    expect(group?.type).toBe('group');
    if (group?.type !== 'group') throw new Error('Expected group');
    expect(group.children).toEqual([leaf]);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000f5',
      type: 'history.undo', payload: {} });
    expect(dispatcher.project?.icons[0]).toEqual(icon);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000f6',
      type: 'history.redo', payload: {} });
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project).toEqual(dispatcher.project);
  });
  it('undoes and replays one selection transform transaction', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const nodeId = '0198e09b-a810-7000-8000-0000000000e1';
    const icon: IconV1 = { id: '0198e09b-a810-7000-8000-0000000000e0', name: 'box', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [],
      nodes: [{ id: nodeId, type: 'rect', visible: true, locked: false,
        x: 0, y: 0, width: 8, height: 8, rx: 0, ry: 0 }] };
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000e2',
      type: 'icon.add', payload: { icon } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000e3',
      type: 'selection.transform', payload: { iconId: icon.id, nodeIds: [nodeId], matrix: [1, 0, 0, 1, 2, 3] } });
    expect(dispatcher.project?.icons[0]?.nodes[0]?.transform).toEqual([1, 0, 0, 1, 2, 3]);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000e4',
      type: 'history.undo', payload: {} });
    expect(dispatcher.project?.icons[0]).toEqual(icon);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000e5',
      type: 'history.redo', payload: {} });
    expect(dispatcher.project?.icons[0]?.nodes[0]?.transform).toEqual([1, 0, 0, 1, 2, 3]);
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project).toEqual(dispatcher.project);
  });
  it('replays icon changes and reverses each committed icon transaction', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const icon: IconV1 = { id: '0198e09b-a810-7000-8000-000000000010', name: 'heart', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], nodes: [], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [] };
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000011', type: 'icon.add', payload: { icon } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000012', type: 'icon.rename', payload: { iconId: icon.id, name: 'pulse' } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000013', type: 'history.undo', payload: {} });
    expect(dispatcher.project?.icons[0]?.name).toBe('heart');
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000014', type: 'history.redo', payload: {} });
    expect(dispatcher.project?.icons[0]?.name).toBe('pulse');
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project).toEqual(dispatcher.project);
  });

  it('undoes and replays metadata insertion and clearing', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const icon: IconV1 = { id: '0198e09b-a810-7000-8000-000000000050', name: 'heart', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], nodes: [], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [] };
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000051', type: 'icon.add', payload: { icon } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000052', type: 'icon.updateMetadata',
      payload: { iconId: icon.id, patch: { tags: ['clinical'], font: { codepoint: 0xe000 } } } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000053', type: 'icon.updateMetadata',
      payload: { iconId: icon.id, patch: { font: null } } });
    expect(dispatcher.project?.icons[0]?.font).toBeUndefined();
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000054', type: 'history.undo', payload: {} });
    expect(dispatcher.project?.icons[0]?.font?.codepoint).toBe(0xe000);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000055', type: 'history.undo', payload: {} });
    expect(dispatcher.project?.icons[0]).toEqual(icon);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000056', type: 'history.redo', payload: {} });
    expect(dispatcher.project?.icons[0]?.tags).toEqual(['clinical']);
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project).toEqual(dispatcher.project);
  });

  it('undoes and replays export profile replacement', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const profile = { id: '0198e09b-a810-7000-8000-000000000060', name: 'web-icons', target: 'svg' as const,
      options: { precision: 3 as const, sizeAttrs: false, paintMode: 'currentColor' as const, metadata: false } };
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000061', type: 'exportProfile.upsert',
      payload: { profile } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000062', type: 'exportProfile.upsert',
      payload: { profile: { ...profile, options: { ...profile.options, precision: 2 } } } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000063', type: 'history.undo', payload: {} });
    expect(dispatcher.project?.exportProfiles[0]).toEqual(profile);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000064', type: 'history.redo', payload: {} });
    expect(dispatcher.project?.exportProfiles[0]?.target).toBe('svg');
    expect(dispatcher.project?.exportProfiles[0]?.options).toMatchObject({ precision: 2 });
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project).toEqual(dispatcher.project);
  });

  it('replays and undoes deterministic icon duplication', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const icon: IconV1 = { id: '0198e09b-a810-7000-8000-000000000090', name: 'heart', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], nodes: [], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [] };
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000091', type: 'icon.add', payload: { icon } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000092', type: 'icon.duplicate',
      payload: { iconId: icon.id, newIconId: '0198e09b-a810-7000-8000-000000000093', idMap: {} } });
    expect(dispatcher.project?.icons.map(item => item.name)).toEqual(['heart', 'heart-copy']);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000094', type: 'history.undo', payload: {} });
    expect(dispatcher.project?.icons).toEqual([icon]);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000095', type: 'history.redo', payload: {} });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000096', type: 'icon.duplicate',
      payload: { iconId: icon.id, newIconId: '0198e09b-a810-7000-8000-000000000097', idMap: {} } });
    expect(dispatcher.project?.icons.map(item => item.name)).toEqual(['heart', 'heart-copy', 'heart-copy-2']);
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project).toEqual(dispatcher.project);
  });

  it('undoes and replays a variant replacement', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const icon: IconV1 = { id: '0198e09b-a810-7000-8000-0000000000a0', name: 'heart', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], nodes: [], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [] };
    const variant = { id: '0198e09b-a810-7000-8000-0000000000a1', name: 'small', dimensions: { size: 16 }, overrides: [] };
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000a2', type: 'icon.add', payload: { icon } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000a3', type: 'variant.add',
      payload: { iconId: icon.id, variant } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000a4', type: 'variant.update',
      payload: { iconId: icon.id, variant: { ...variant, dimensions: { size: 20 } } } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000a5', type: 'history.undo', payload: {} });
    expect(dispatcher.project?.icons[0]?.variants[0]).toEqual(variant);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000a6', type: 'history.redo', payload: {} });
    expect(dispatcher.project?.icons[0]?.variants[0]?.dimensions.size).toBe(20);
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project).toEqual(dispatcher.project);
  });

  it('undoes and replays a component update', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const component = { id: '0198e09b-a810-7000-8000-0000000000c0', name: 'cross', parameters: [], nodes: [] };
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000c1', type: 'component.add',
      payload: { component } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000c2', type: 'component.update',
      payload: { component: { ...component, name: 'plus' } } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000c3', type: 'history.undo', payload: {} });
    expect(dispatcher.project?.components).toEqual([component]);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000c4', type: 'history.redo', payload: {} });
    expect(dispatcher.project?.components[0]?.name).toBe('plus');
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project).toEqual(dispatcher.project);
  });

  it('undoes and replays a multi-node removal', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    const icon: IconV1 = { id: '0198e09b-a810-7000-8000-0000000000e0', name: 'heart', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], nodes: [], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [] };
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000e1', type: 'icon.add', payload: { icon } });
    const rect = (id: string) => ({ id, type: 'rect' as const, visible: true, locked: false,
      x: 0, y: 0, width: 8, height: 8, rx: 0, ry: 0 });
    const first = rect('0198e09b-a810-7000-8000-0000000000e2');
    const second = rect('0198e09b-a810-7000-8000-0000000000e3');
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000e4', type: 'node.add',
      payload: { iconId: icon.id, index: 0, node: first } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000e5', type: 'node.add',
      payload: { iconId: icon.id, index: 1, node: second } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000e6', type: 'node.remove',
      payload: { iconId: icon.id, nodeIds: [first.id, second.id] } });
    expect(dispatcher.project?.icons[0]?.nodes).toEqual([]);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000e7', type: 'history.undo', payload: {} });
    expect(dispatcher.project?.icons[0]?.nodes).toEqual([first, second]);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-0000000000e8', type: 'history.redo', payload: {} });
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project).toEqual(dispatcher.project);
  });

  it('undoes and replays token and design-system transactions', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000020', type: 'token.upsert',
      payload: { token: { name: 'accent', light: '#112233' } } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000021', type: 'project.updateDesignSystem',
      payload: { patch: { defaultPaintToken: 'accent' } } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000022', type: 'history.undo', payload: {} });
    expect(dispatcher.project?.designSystem.defaultPaintToken).toBe('currentColor');
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000023', type: 'history.undo', payload: {} });
    expect(dispatcher.project?.tokens).toEqual([]);
    expect(ProjectDispatcher.replay(null, dispatcher.journal).project).toEqual(dispatcher.project);
  });
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
    const patch = tampered[1]!.patches[0]!;
    if (patch.op !== 'replace') throw new Error('Expected rename patch');
    patch.after = 'Tampered';
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

  it('restores undo, redo and command idempotency from a compacted checkpoint', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    dispatcher.dispatch(rename);
    const checkpoint = dispatcher.checkpoint();
    const reopened = ProjectDispatcher.replay(dispatcher.project, [], checkpoint);
    expect(reopened.dispatch(rename)).toEqual(dispatcher.dispatch(rename));
    expect(reopened.revision).toBe(2);
    reopened.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000004',
      type: 'history.undo', payload: {} });
    expect(reopened.project?.name).toBe('Medical');
    expect(ProjectDispatcher.replay(dispatcher.project, reopened.journal, checkpoint).project).toEqual(reopened.project);
    expect(() => ProjectDispatcher.replay(dispatcher.project, [], { ...checkpoint, checksum: '0'.repeat(64) }))
      .toThrow('checkpoint.invalid');
  });

  it('salvages checked journal patches after a damaged checkpoint, including undo', () => {
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch(create);
    dispatcher.dispatch(rename);
    const snapshot = dispatcher.project!;
    const checkpoint = dispatcher.checkpoint();
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000004',
      type: 'project.rename', payload: { name: 'Updated' }, expectedRevision: 2 });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000005',
      type: 'history.undo', payload: {}, expectedRevision: 3 });
    const journal = dispatcher.journal.slice(2);
    expect(() => ProjectDispatcher.replay(snapshot, journal, { ...checkpoint, checksum: '0'.repeat(64) }))
      .toThrow('checkpoint.invalid');
    const salvaged = ProjectDispatcher.salvage(snapshot, journal);
    expect(salvaged).toEqual({ project: dispatcher.project, validLength: 2, corruptTail: false });
    const corrupt = [...journal, { ...journal[1]!, checksum: '0'.repeat(64) }];
    expect(ProjectDispatcher.salvage(snapshot, corrupt)).toEqual({ project: dispatcher.project,
      validLength: 2, corruptTail: true });
    expect(journal).toHaveLength(2);
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
