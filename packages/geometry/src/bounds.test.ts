import { describe, expect, it } from 'vitest';
import type { ProjectV1 } from '@iconforge/project-model';
import { iconGeometryBounds } from './bounds.js';

const id = (part: number): string => `0198e09b-a810-7000-8000-${part.toString(16).padStart(12, '0')}`;
const project: ProjectV1 = {
  schemaVersion: '1.0', id: id(1), name: 'Bounds', revision: 1,
  designSystem: { grid: { width: 24, height: 24 }, safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
    style: 'filled', stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 }, cornerRadius: 2,
    defaultPaintToken: 'currentColor', naming: { pattern: 'kebab', reserved: [] }, severities: {} },
  tokens: [], components: [], exportProfiles: [], provenance: [],
  icons: [{ id: id(2), name: 'curves', aliases: [], tags: [], viewBox: [0, 0, 24, 24],
    accessibility: { kind: 'decorative' }, provenanceIds: [], variants: [], nodes: [] }],
};

describe('scene geometry bounds', () => {
  it('finds quadratic and cubic extrema instead of using control-point bounds', () => {
    const input = structuredClone(project);
    input.icons[0]!.nodes = [{ id: id(3), type: 'path', visible: true, locked: false, fillRule: 'nonzero',
      path: [{ start: [0, 0], segments: [
        { k: 'Q', c: [10, 20], to: [20, 0] },
        { k: 'C', c1: [20, -12], c2: [40, -12], to: [40, 0] },
      ], closed: false }] }];
    expect(iconGeometryBounds(input, input.icons[0]!)).toEqual({ minX: 0, minY: -9, maxX: 40, maxY: 10 });
  });

  it('composes nested transforms and includes the exact affine ellipse box', () => {
    const input = structuredClone(project);
    input.icons[0]!.nodes = [{ id: id(4), type: 'group', visible: true, locked: false,
      transform: [1, 0, 0, 1, 3, 4], children: [{ id: id(5), type: 'ellipse', visible: true, locked: false,
        cx: 0, cy: 0, rx: 4, ry: 2, transform: [0, 1, -1, 0, 0, 0] }] }];
    expect(iconGeometryBounds(input, input.icons[0]!)).toEqual({ minX: 1, minY: 0, maxX: 5, maxY: 8 });
  });

  it('finds curve extrema after applying the full affine transform', () => {
    const input = structuredClone(project);
    input.icons[0]!.nodes = [{ id: id(11), type: 'path', visible: true, locked: false,
      transform: [0, 1, -1, 0, 5, 0], fillRule: 'nonzero',
      path: [{ start: [0, 0], segments: [{ k: 'Q', c: [10, 20], to: [20, 0] }], closed: false }] }];
    expect(iconGeometryBounds(input, input.icons[0]!)).toEqual({ minX: -5, minY: 0, maxX: 5, maxY: 20 });
  });

  it('resolves component bindings and variants without mutating the project', () => {
    const input = structuredClone(project);
    input.components = [{ id: id(6), name: 'rounded', parameters: [{ name: 'show', type: 'boolean', default: true }],
      bindings: [{ parameter: 'show', nodeId: id(7), field: 'visible' }],
      nodes: [{ id: id(7), type: 'rect', visible: true, locked: false, x: 2, y: 3,
        width: 4, height: 5, rx: 0, ry: 0 }] }];
    input.icons[0]!.nodes = [
      { id: id(8), type: 'instance', visible: true, locked: false, componentId: id(6), arguments: {},
        transform: [1, 0, 0, 1, 10, 0] },
      { id: id(9), type: 'line', visible: true, locked: false, x1: 0, y1: 0, x2: 1, y2: 1,
        stroke: { paint: { kind: 'none' }, width: 1, cap: 'butt', join: 'bevel', miterLimit: 4 } },
    ];
    input.icons[0]!.variants = [{ id: id(10), name: 'hidden', dimensions: { state: 'hidden' },
      overrides: [{ op: 'hide', nodeId: id(9) }] }];
    const before = JSON.stringify(input);
    expect(iconGeometryBounds(input, input.icons[0]!)).toEqual({ minX: 0, minY: 0, maxX: 16, maxY: 8 });
    expect(iconGeometryBounds(input, input.icons[0]!, id(10))).toEqual({ minX: 12, minY: 3, maxX: 16, maxY: 8 });
    expect(JSON.stringify(input)).toBe(before);
    const instance = input.icons[0]!.nodes[0]!;
    if (instance.type !== 'instance') throw new Error('Fixture must contain an instance');
    instance.arguments.show = false;
    expect(iconGeometryBounds(input, input.icons[0]!, id(10))).toBeNull();
  });

  it('returns null for scenes with no geometry', () => {
    expect(iconGeometryBounds(project, project.icons[0]!)).toBeNull();
  });
});
