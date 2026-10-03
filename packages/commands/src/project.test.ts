import { describe, expect, it } from 'vitest';
import { applyProjectCommand } from './project.js';
import type { IconV1 } from '@iconforge/project-model';

const id = '0198e09b-a810-7000-8000-000000000001';
const commandId = '0198e09b-a810-7000-8000-000000000002';
const envelope = {
  commandVersion: '1.0' as const, commandId, projectId: id,
  issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' as const },
};
const icon: IconV1 = {
  id: '0198e09b-a810-7000-8000-000000000010', name: 'heart', aliases: [], tags: [],
  viewBox: [0, 0, 24, 24], nodes: [], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [],
};

describe('project command handlers', () => {
  it('creates a valid project using only command data and defaults', () => {
    const result = applyProjectCommand(null, { ...envelope, type: 'project.create', payload: { id, name: 'Medical' } });
    expect(result.project.id).toBe(id);
    expect(result.project.revision).toBe(1);
    expect(result.project.designSystem.grid).toEqual({ width: 24, height: 24 });
    expect(result.patches).toHaveLength(1);
    expect(result.inversePatches).toHaveLength(1);
  });

  it('renames without mutating the original project and yields reversible patches', () => {
    const created = applyProjectCommand(null, { ...envelope, type: 'project.create', payload: { id, name: 'Medical' } });
    const renamed = applyProjectCommand(created.project, {
      ...envelope, commandId: '0198e09b-a810-7000-8000-000000000003',
      type: 'project.rename', payload: { name: 'Clinical' }, expectedRevision: 1,
    });
    expect(created.project.name).toBe('Medical');
    expect(renamed.project.name).toBe('Clinical');
    expect(renamed.project.revision).toBe(2);
    expect(renamed.patches).toEqual([{ op: 'replace', path: ['name'], before: 'Medical', after: 'Clinical' }]);
    expect(renamed.inversePatches).toEqual([{ op: 'replace', path: ['name'], before: 'Clinical', after: 'Medical' }]);
  });

  it('rejects stale revisions and invalid names', () => {
    const created = applyProjectCommand(null, { ...envelope, type: 'project.create', payload: { id, name: 'Medical' } });
    expect(() => applyProjectCommand(created.project, { ...envelope, type: 'project.rename', payload: { name: 'New' }, expectedRevision: 0 })).toThrow('revision.conflict');
    expect(() => applyProjectCommand(created.project, { ...envelope, type: 'project.rename', payload: { name: '' } })).toThrow();
  });

  it('adds, renames and removes an icon without mutating earlier states', () => {
    const created = applyProjectCommand(null, { ...envelope, type: 'project.create', payload: { id, name: 'Medical' } });
    const added = applyProjectCommand(created.project, { ...envelope, type: 'icon.add', payload: { icon } });
    const renamed = applyProjectCommand(added.project, { ...envelope, type: 'icon.rename', payload: { iconId: icon.id, name: 'pulse' } });
    const removed = applyProjectCommand(renamed.project, { ...envelope, type: 'icon.remove', payload: { iconId: icon.id } });
    expect(created.project.icons).toEqual([]);
    expect(added.project.icons[0]?.name).toBe('heart');
    expect(renamed.project.icons[0]?.name).toBe('pulse');
    expect(removed.project.icons).toEqual([]);
    expect(added.result.patchSummary).toEqual({ added: 1, updated: 0, removed: 0, iconsAffected: [icon.id] });
    expect(added.patches).toEqual([{ op: 'insert', path: ['icons', '0'], value: icon }]);
    expect(renamed.patches).toEqual([{ op: 'replace', path: ['icons', '0', 'name'], before: 'heart', after: 'pulse' }]);
    expect(removed.inversePatches).toEqual([{ op: 'insert', path: ['icons', '0'], value: renamed.project.icons[0] }]);
  });

  it('rejects duplicate names and missing icon targets', () => {
    const created = applyProjectCommand(null, { ...envelope, type: 'project.create', payload: { id, name: 'Medical' } });
    const added = applyProjectCommand(created.project, { ...envelope, type: 'icon.add', payload: { icon } });
    expect(() => applyProjectCommand(added.project, { ...envelope, type: 'icon.add', payload: { icon: { ...icon, id: '0198e09b-a810-7000-8000-000000000011' } } })).toThrow();
    expect(() => applyProjectCommand(added.project, { ...envelope, type: 'icon.remove', payload: { iconId: '0198e09b-a810-7000-8000-000000000099' } })).toThrow('icon.not-found');
  });

  it('updates design policy and color tokens without rewriting icons', () => {
    const created = applyProjectCommand(null, { ...envelope, type: 'project.create', payload: { id, name: 'Medical' } });
    const token = { name: 'accent', light: '#112233', dark: '#ddeeff' };
    const upserted = applyProjectCommand(created.project, { ...envelope, type: 'token.upsert', payload: { token } });
    const updated = applyProjectCommand(upserted.project, { ...envelope, type: 'project.updateDesignSystem',
      payload: { patch: { defaultPaintToken: 'accent' } } });
    expect(created.project.tokens).toEqual([]);
    expect(upserted.project.tokens).toEqual([token]);
    expect(updated.project.designSystem.defaultPaintToken).toBe('accent');
    expect(updated.project.icons).toEqual(created.project.icons);
    expect(() => applyProjectCommand(updated.project, { ...envelope, type: 'token.remove', payload: { name: 'accent' } }))
      .toThrow('token.in-use');
    const reset = applyProjectCommand(updated.project, { ...envelope, type: 'project.updateDesignSystem',
      payload: { patch: { defaultPaintToken: 'currentColor' } } });
    const removed = applyProjectCommand(reset.project, { ...envelope, type: 'token.remove', payload: { name: 'accent' } });
    expect(removed.project.tokens).toEqual([]);
    expect(removed.inversePatches).toEqual([{ op: 'insert', path: ['tokens', '0'], value: token }]);
  });

  it('blocks token removal while an icon node refers to it', () => {
    const created = applyProjectCommand(null, { ...envelope, type: 'project.create', payload: { id, name: 'Medical' } });
    const upserted = applyProjectCommand(created.project, { ...envelope, type: 'token.upsert',
      payload: { token: { name: 'accent', light: '#112233' } } });
    const added = applyProjectCommand(upserted.project, { ...envelope, type: 'icon.add', payload: { icon: {
      ...icon, nodes: [{ id: '0198e09b-a810-7000-8000-000000000012', type: 'rect', visible: true, locked: false,
        x: 0, y: 0, width: 10, height: 10, rx: 0, ry: 0, fill: { kind: 'token', token: 'accent' } }],
    } } });
    expect(() => applyProjectCommand(added.project, { ...envelope, type: 'token.remove', payload: { name: 'accent' } }))
      .toThrow('token.in-use');
  });

  it('updates icon metadata through narrow reversible patches', () => {
    const created = applyProjectCommand(null, { ...envelope, type: 'project.create', payload: { id, name: 'Medical' } });
    const added = applyProjectCommand(created.project, { ...envelope, type: 'icon.add', payload: { icon } });
    const updated = applyProjectCommand(added.project, { ...envelope, type: 'icon.updateMetadata', payload: {
      iconId: icon.id, patch: { aliases: ['cardiac'], tags: ['clinical'], accessibility: { kind: 'informative', label: 'Heart' },
        font: { codepoint: 0xe000, ligature: 'heart' } },
    } });
    expect(added.project.icons[0]).toEqual(icon);
    expect(updated.project.icons[0]).toMatchObject({ aliases: ['cardiac'], tags: ['clinical'],
      accessibility: { kind: 'informative', label: 'Heart' }, font: { codepoint: 0xe000, ligature: 'heart' } });
    expect(updated.patches.map(patch => patch.path)).toEqual([
      ['icons', '0', 'aliases'], ['icons', '0', 'tags'], ['icons', '0', 'accessibility'], ['icons', '0', 'font'],
    ]);
    expect(updated.patches[3]?.op).toBe('insert');
    expect(updated.inversePatches[3]?.op).toBe('remove');
    const cleared = applyProjectCommand(updated.project, { ...envelope, type: 'icon.updateMetadata', payload: {
      iconId: icon.id, patch: { font: null },
    } });
    expect(cleared.project.icons[0]?.font).toBeUndefined();
    expect(cleared.patches).toEqual([{ op: 'remove', path: ['icons', '0', 'font'], value: { codepoint: 0xe000, ligature: 'heart' } }]);
    expect(() => applyProjectCommand(added.project, { ...envelope, type: 'icon.updateMetadata', payload: {
      iconId: icon.id, patch: { aliases: ['Not A Slug'] },
    } })).toThrow();
  });

  it('upserts and removes an export profile with bounded inverse patches', () => {
    const created = applyProjectCommand(null, { ...envelope, type: 'project.create', payload: { id, name: 'Medical' } });
    const profile = { id: '0198e09b-a810-7000-8000-000000000040', name: 'web-icons', target: 'svg' as const,
      options: { precision: 3 as const, sizeAttrs: false, paintMode: 'currentColor' as const, metadata: false } };
    const added = applyProjectCommand(created.project, { ...envelope, type: 'exportProfile.upsert', payload: { profile } });
    expect(added.project.exportProfiles).toEqual([profile]);
    expect(added.patches).toEqual([{ op: 'insert', path: ['exportProfiles', '0'], value: profile }]);
    const changed = { ...profile, options: { ...profile.options, precision: 2 as const } };
    const updated = applyProjectCommand(added.project, { ...envelope, type: 'exportProfile.upsert', payload: { profile: changed } });
    expect(added.project.exportProfiles).toEqual([profile]);
    expect(updated.patches).toEqual([{ op: 'replace', path: ['exportProfiles', '0'], before: profile, after: changed }]);
    const removed = applyProjectCommand(updated.project, { ...envelope, type: 'exportProfile.remove', payload: { profileId: profile.id } });
    expect(removed.project.exportProfiles).toEqual([]);
    expect(removed.inversePatches).toEqual([{ op: 'insert', path: ['exportProfiles', '0'], value: changed }]);
    expect(() => applyProjectCommand(removed.project, { ...envelope, type: 'exportProfile.remove',
      payload: { profileId: profile.id } })).toThrow('export-profile.not-found');
  });
});
