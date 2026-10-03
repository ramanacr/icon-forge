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

  it('duplicates an icon with caller-supplied IDs and remapped variant references', () => {
    const created = applyProjectCommand(null, { ...envelope, type: 'project.create', payload: { id, name: 'Medical' } });
    const groupId = '0198e09b-a810-7000-8000-000000000070';
    const childId = '0198e09b-a810-7000-8000-000000000071';
    const variantId = '0198e09b-a810-7000-8000-000000000072';
    const replacementId = '0198e09b-a810-7000-8000-000000000073';
    const source: IconV1 = { ...icon, nodes: [{ id: groupId, type: 'group', visible: true, locked: false,
      children: [{ id: childId, type: 'rect', visible: true, locked: false, x: 1, y: 1, width: 8, height: 8, rx: 0, ry: 0 }] }],
      variants: [{ id: variantId, name: 'small', dimensions: { size: 16 }, overrides: [{ op: 'replaceNode', nodeId: childId,
        node: { id: replacementId, type: 'ellipse', visible: true, locked: false, cx: 4, cy: 4, rx: 2, ry: 2 } }] }] };
    const added = applyProjectCommand(created.project, { ...envelope, type: 'icon.add', payload: { icon: source } });
    const newIconId = '0198e09b-a810-7000-8000-000000000080';
    const idMap = { [groupId]: '0198e09b-a810-7000-8000-000000000081',
      [childId]: '0198e09b-a810-7000-8000-000000000082', [variantId]: '0198e09b-a810-7000-8000-000000000083',
      [replacementId]: '0198e09b-a810-7000-8000-000000000084' };
    const duplicated = applyProjectCommand(added.project, { ...envelope, type: 'icon.duplicate',
      payload: { iconId: icon.id, newIconId, idMap } });
    expect(duplicated.project.icons[0]).toEqual(source);
    expect(duplicated.project.icons[1]).toMatchObject({ id: newIconId, name: 'heart-copy',
      nodes: [{ id: idMap[groupId], children: [{ id: idMap[childId] }] }],
      variants: [{ id: idMap[variantId], overrides: [{ nodeId: idMap[childId], node: { id: idMap[replacementId] } }] }] });
    expect(duplicated.patches).toEqual([{ op: 'insert', path: ['icons', '1'], value: duplicated.project.icons[1] }]);
    expect(() => applyProjectCommand(added.project, { ...envelope, type: 'icon.duplicate',
      payload: { iconId: icon.id, newIconId, idMap: { [groupId]: idMap[groupId] } } })).toThrow('icon.duplicate.id-map');
  });

  it('adds, replaces and removes an icon variant with reversible narrow patches', () => {
    const created = applyProjectCommand(null, { ...envelope, type: 'project.create', payload: { id, name: 'Medical' } });
    const addedIcon = applyProjectCommand(created.project, { ...envelope, type: 'icon.add', payload: { icon } });
    const variant = { id: '0198e09b-a810-7000-8000-000000000085', name: 'small', dimensions: { size: 16 }, overrides: [] };
    const added = applyProjectCommand(addedIcon.project, { ...envelope, type: 'variant.add',
      payload: { iconId: icon.id, variant } });
    expect(added.project.icons[0]?.variants).toEqual([variant]);
    expect(added.patches).toEqual([{ op: 'insert', path: ['icons', '0', 'variants', '0'], value: variant }]);
    const changed = { ...variant, dimensions: { size: 20 } };
    const updated = applyProjectCommand(added.project, { ...envelope, type: 'variant.update',
      payload: { iconId: icon.id, variant: changed } });
    expect(updated.patches).toEqual([{ op: 'replace', path: ['icons', '0', 'variants', '0'], before: variant, after: changed }]);
    const removed = applyProjectCommand(updated.project, { ...envelope, type: 'variant.remove',
      payload: { iconId: icon.id, variantId: variant.id } });
    expect(removed.project.icons[0]?.variants).toEqual([]);
    expect(removed.inversePatches).toEqual([{ op: 'insert', path: ['icons', '0', 'variants', '0'], value: changed }]);
    expect(() => applyProjectCommand(addedIcon.project, { ...envelope, type: 'variant.remove',
      payload: { iconId: icon.id, variantId: variant.id } })).toThrow('variant.not-found');
  });

  it('adds, updates and removes a component while protecting instance references', () => {
    const created = applyProjectCommand(null, { ...envelope, type: 'project.create', payload: { id, name: 'Medical' } });
    const component = { id: '0198e09b-a810-7000-8000-0000000000b0', name: 'cross', parameters: [], nodes: [] };
    const added = applyProjectCommand(created.project, { ...envelope, type: 'component.add', payload: { component } });
    expect(added.patches).toEqual([{ op: 'insert', path: ['components', '0'], value: component }]);
    const changed = { ...component, name: 'plus' };
    const updated = applyProjectCommand(added.project, { ...envelope, type: 'component.update', payload: { component: changed } });
    expect(updated.patches).toEqual([{ op: 'replace', path: ['components', '0'], before: component, after: changed }]);
    const referencing = applyProjectCommand(updated.project, { ...envelope, type: 'icon.add', payload: { icon: { ...icon,
      nodes: [{ id: '0198e09b-a810-7000-8000-0000000000b1', type: 'instance', visible: true, locked: false,
        componentId: component.id, arguments: {} }] } } });
    expect(() => applyProjectCommand(referencing.project, { ...envelope, type: 'component.remove',
      payload: { componentId: component.id } })).toThrow('component.in-use');
    const removed = applyProjectCommand(updated.project, { ...envelope, type: 'component.remove',
      payload: { componentId: component.id } });
    expect(removed.project.components).toEqual([]);
    expect(removed.inversePatches).toEqual([{ op: 'insert', path: ['components', '0'], value: changed }]);
  });

  it('adds and removes top-level and nested nodes with stable inverse paths', () => {
    const created = applyProjectCommand(null, { ...envelope, type: 'project.create', payload: { id, name: 'Medical' } });
    const addedIcon = applyProjectCommand(created.project, { ...envelope, type: 'icon.add', payload: { icon } });
    const rect = { id: '0198e09b-a810-7000-8000-0000000000d0', type: 'rect' as const, visible: true, locked: false,
      x: 0, y: 0, width: 8, height: 8, rx: 0, ry: 0 };
    const group = { id: '0198e09b-a810-7000-8000-0000000000d1', type: 'group' as const, visible: true, locked: false,
      children: [] as IconV1['nodes'] };
    const child = { ...rect, id: '0198e09b-a810-7000-8000-0000000000d2' };
    const first = applyProjectCommand(addedIcon.project, { ...envelope, type: 'node.add',
      payload: { iconId: icon.id, index: 0, node: rect } });
    const second = applyProjectCommand(first.project, { ...envelope, type: 'node.add',
      payload: { iconId: icon.id, index: 1, node: group } });
    const third = applyProjectCommand(second.project, { ...envelope, type: 'node.add',
      payload: { iconId: icon.id, parentId: group.id, index: 0, node: child } });
    expect(third.project.icons[0]?.nodes).toMatchObject([{ id: rect.id }, { id: group.id, children: [{ id: child.id }] }]);
    expect(third.patches).toEqual([{ op: 'insert', path: ['icons', '0', 'nodes', '1', 'children', '0'], value: child }]);
    expect(() => applyProjectCommand(third.project, { ...envelope, type: 'node.remove',
      payload: { iconId: icon.id, nodeIds: [group.id, child.id] } })).toThrow('node.remove.overlap');
    const removed = applyProjectCommand(third.project, { ...envelope, type: 'node.remove',
      payload: { iconId: icon.id, nodeIds: [rect.id, child.id] } });
    expect(removed.project.icons[0]?.nodes).toMatchObject([{ id: group.id, children: [] }]);
    expect(removed.patches.map(patch => patch.path)).toEqual([
      ['icons', '0', 'nodes', '1', 'children', '0'], ['icons', '0', 'nodes', '0'],
    ]);
    expect(removed.inversePatches.map(patch => patch.path)).toEqual([
      ['icons', '0', 'nodes', '0'], ['icons', '0', 'nodes', '1', 'children', '0'],
    ]);
  });
});
