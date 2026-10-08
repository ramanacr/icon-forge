import { describe, expect, it } from 'vitest';
import type { ProjectV1, SceneNodeV1 } from '@iconforge/project-model';
import { iconConsistencyWarnings, STROKE_WIDTH_RULE } from './consistency.js';
import { SAFE_AREA_RULE, STROKE_CAP_RULE, STROKE_JOIN_RULE } from '@iconforge/rules';

const stroke = { paint: { kind: 'color' as const, value: '#123456' }, width: 2.5,
  cap: 'round' as const, join: 'round' as const, miterLimit: 4 };
const rectangle: SceneNodeV1 = { id: 'node', type: 'rect', visible: true, locked: false,
  x: 2, y: 2, width: 10, height: 10, rx: 0, ry: 0, stroke };
const project: ProjectV1 = {
  schemaVersion: '1.0', id: 'project', name: 'Set', revision: 0,
  designSystem: { grid: { width: 24, height: 24 }, safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
    style: 'outline', stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 },
    cornerRadius: 2, defaultPaintToken: 'currentColor', naming: { pattern: 'kebab', reserved: [] }, severities: {} },
  tokens: [], components: [], icons: [{ id: 'icon', name: 'sample', aliases: [], tags: [],
    viewBox: [0, 0, 24, 24], nodes: [rectangle], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [] }],
  exportProfiles: [], provenance: [],
};

describe('overview consistency warnings', () => {
  it('checks visible painted strokes and keeps the project unchanged', () => {
    const before = structuredClone(project);
    expect(iconConsistencyWarnings(project, project.icons[0]!)).toEqual([{
      code: STROKE_WIDTH_RULE, severity: 'warning', count: 1,
      message: '1 stroke width differs from set width 1.75',
    }]);
    expect(iconConsistencyWarnings({ ...project, icons: [{ ...project.icons[0]!, nodes: [{ ...rectangle, visible: false }] }] },
      { ...project.icons[0]!, nodes: [{ ...rectangle, visible: false }] })).toEqual([]);
    expect(project).toEqual(before);
  });

  it('respects project and icon severity overrides', () => {
    const configured = { ...project, designSystem: { ...project.designSystem,
      severities: { [STROKE_WIDTH_RULE]: 'error' as const } } };
    expect(iconConsistencyWarnings(configured, configured.icons[0]!)[0]?.severity).toBe('error');
    expect(iconConsistencyWarnings(configured, { ...configured.icons[0]!,
      ruleOverrides: { [STROKE_WIDTH_RULE]: 'off' } })).toEqual([]);
  });

  it('summarizes located safe area warnings', () => {
    const icon = { ...project.icons[0]!, nodes: [{ ...rectangle, x: 1 }] };
    expect(iconConsistencyWarnings(project, icon).find(warning => warning.code === SAFE_AREA_RULE)).toEqual({
      code: SAFE_AREA_RULE, severity: 'warning', count: 1, message: '1 shape crosses the set safe area',
    });
  });

  it('summarizes stroke cap and join warnings independently', () => {
    const icon = { ...project.icons[0]!, nodes: [{ ...rectangle,
      stroke: { ...stroke, width: 1.75, cap: 'square' as const, join: 'bevel' as const } }] };
    expect(iconConsistencyWarnings(project, icon)).toEqual([
      { code: STROKE_CAP_RULE, severity: 'warning', count: 1,
        message: '1 stroke cap differs from set policy' },
      { code: STROKE_JOIN_RULE, severity: 'warning', count: 1,
        message: '1 stroke join differs from set policy' },
    ]);
  });
});
