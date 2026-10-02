import { describe, expect, it } from 'vitest';
import type { ProjectV1 } from './types.js';
import { assertProject } from './validation.js';

const emptyProject: ProjectV1 = {
  schemaVersion: '1.0', id: '0198e09b-a810-7000-8000-000000000001',
  name: 'Medical', revision: 0,
  designSystem: {
    grid: { width: 24, height: 24 },
    safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
    style: 'outline', stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 },
    cornerRadius: 2, defaultPaintToken: 'currentColor',
    naming: { pattern: 'kebab', reserved: [] }, severities: {},
  },
  tokens: [], components: [], icons: [], exportProfiles: [], provenance: [],
};

describe('project validation', () => {
  it('accepts a minimal v1 project', () => {
    expect(assertProject(emptyProject)).toBe(emptyProject);
  });

  it('rejects unknown fields outside extensions', () => {
    expect(() => assertProject({ ...emptyProject, surprise: true })).toThrow();
  });

  it('rejects wrong schema versions and unquantized coordinates', () => {
    expect(() => assertProject({ ...emptyProject, schemaVersion: '2.0' })).toThrow();
    expect(() => assertProject({ ...emptyProject, designSystem: { ...emptyProject.designSystem, cornerRadius: 1.2345 } })).toThrow();
  });

  it('preserves namespaced extensions', () => {
    const extended = { ...emptyProject, extensions: { 'com.example.notes': { arbitrary: true } } };
    expect(assertProject(extended)).toBe(extended);
  });

  it('rejects duplicate ids and dangling component references', () => {
    const icon = {
      id: '0198e09b-a810-7000-8000-000000000002', name: 'medical-cross', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [],
      nodes: [{ id: '0198e09b-a810-7000-8000-000000000003', type: 'instance', componentId: '0198e09b-a810-7000-8000-000000000099', arguments: {}, visible: true, locked: false }],
    };
    expect(() => assertProject({ ...emptyProject, icons: [icon] })).toThrow();
    const duplicate = { ...icon, nodes: [{ ...icon.nodes[0], id: icon.id }] };
    expect(() => assertProject({ ...emptyProject, icons: [duplicate] })).toThrow();
  });

  it('rejects invalid icon names', () => {
    const icon = {
      id: '0198e09b-a810-7000-8000-000000000002', name: 'Medical Cross', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], nodes: [], variants: [],
      accessibility: { kind: 'decorative' }, provenanceIds: [],
    };
    expect(() => assertProject({ ...emptyProject, icons: [icon] })).toThrow();
  });

  it('allows repeated component instances but rejects component cycles', () => {
    const componentId = '0198e09b-a810-7000-8000-000000000010';
    const component = { id: componentId, name: 'cross', parameters: [], nodes: [] as unknown[] };
    const nodes = [
      { id: '0198e09b-a810-7000-8000-000000000011', type: 'instance', componentId, arguments: {}, visible: true, locked: false },
      { id: '0198e09b-a810-7000-8000-000000000012', type: 'instance', componentId, arguments: {}, visible: true, locked: false },
    ];
    const icon = {
      id: '0198e09b-a810-7000-8000-000000000013', name: 'two-crosses', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], nodes, variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [],
    };
    expect(() => assertProject({ ...emptyProject, components: [component], icons: [icon] })).not.toThrow();
    const cyclic = { ...component, nodes: [{ ...nodes[0], id: '0198e09b-a810-7000-8000-000000000014' }] };
    expect(() => assertProject({ ...emptyProject, components: [cyclic], icons: [icon] })).toThrow();
  });
});
