import { describe, expect, it } from 'vitest';
import type { ProjectV1 } from '@iconforge/project-model';
import { SelectionModel } from './selection.js';

const id = (part: number): string => `0198e09b-a810-7000-8000-${part.toString(16).padStart(12, '0')}`;
const project: ProjectV1 = {
  schemaVersion: '1.0', id: id(1), name: 'Selection', revision: 1,
  designSystem: { grid: { width: 24, height: 24 }, safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
    style: 'filled', stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 }, cornerRadius: 2,
    defaultPaintToken: 'currentColor', naming: { pattern: 'kebab', reserved: [] }, severities: {} },
  tokens: [], components: [], exportProfiles: [], provenance: [],
  icons: [{ id: id(2), name: 'grouped', aliases: [], tags: [], viewBox: [0, 0, 24, 24],
    variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [], nodes: [
      { id: id(3), type: 'group', visible: true, locked: false, children: [
        { id: id(4), type: 'rect', visible: true, locked: false, x: 0, y: 0, width: 4, height: 4, rx: 0, ry: 0 },
      ] },
      { id: id(5), type: 'ellipse', visible: true, locked: false, cx: 12, cy: 12, rx: 3, ry: 3 },
    ] }],
};

describe('ephemeral selection', () => {
  it('orders selected nodes by scene order, toggles, and detaches snapshots', () => {
    const selection = new SelectionModel();
    const first = selection.replace(project, id(2), [id(5), id(4)]);
    expect(first.nodeIds).toEqual([id(4), id(5)]);
    first.nodeIds.pop();
    expect(selection.snapshot.nodeIds).toEqual([id(4), id(5)]);
    expect(selection.toggle(project, id(2), id(4)).nodeIds).toEqual([id(5)]);
    expect(selection.toggle(project, id(2), id(4)).nodeIds).toEqual([id(4), id(5)]);
    expect(selection.clear()).toEqual({ iconId: null, nodeIds: [] });
  });

  it('rejects unknown, duplicate, and ancestor-overlapping targets', () => {
    const selection = new SelectionModel();
    expect(() => selection.replace(project, id(2), [id(3), id(4)])).toThrow('selection.overlap');
    expect(() => selection.replace(project, id(2), [id(5), id(5)])).toThrow('selection.duplicate');
    expect(() => selection.replace(project, id(2), [id(99)])).toThrow('selection.node.not-found');
    expect(() => selection.replace(project, id(99), [])).toThrow('selection.icon.not-found');
    expect(selection.snapshot).toEqual({ iconId: null, nodeIds: [] });
  });

  it('reconciles removed nodes and icons without changing the project', () => {
    const selection = new SelectionModel();
    const source = JSON.stringify(project);
    selection.replace(project, id(2), [id(4), id(5)]);
    const changed = structuredClone(project);
    changed.icons[0]!.nodes.pop();
    expect(selection.reconcile(changed).nodeIds).toEqual([id(4)]);
    changed.icons = [];
    expect(selection.reconcile(changed)).toEqual({ iconId: null, nodeIds: [] });
    expect(JSON.stringify(project)).toBe(source);
  });
});
