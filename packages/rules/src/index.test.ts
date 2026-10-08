import { describe, expect, it } from 'vitest';
import type { ProjectV1, SceneNodeV1 } from '@iconforge/project-model';
import { STROKE_WIDTH_RULE, validateIconRules } from './index.js';

const id = (part: number): string => `0198e09b-a810-7000-8000-${part.toString(16).padStart(12, '0')}`;
const stroke = { paint: { kind: 'color' as const, value: '#123456' }, width: 2.5,
  cap: 'round' as const, join: 'round' as const, miterLimit: 4 };
const line: SceneNodeV1 = { id: id(3), type: 'line', visible: true, locked: false,
  x1: 2, y1: 2, x2: 18, y2: 18, stroke };
const project: ProjectV1 = {
  schemaVersion: '1.0', id: id(1), name: 'Set', revision: 0,
  designSystem: { grid: { width: 24, height: 24 }, safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
    style: 'outline', stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 },
    cornerRadius: 2, defaultPaintToken: 'currentColor', naming: { pattern: 'kebab', reserved: [] }, severities: {} },
  tokens: [], components: [], icons: [{ id: id(2), name: 'sample', aliases: [], tags: [],
    viewBox: [0, 0, 24, 24], nodes: [line], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [] }],
  exportProfiles: [], provenance: [],
};

describe('rule registry', () => {
  it('returns located, deterministic diagnostics without editing the project', () => {
    const before = structuredClone(project);
    expect(validateIconRules(project, project.icons[0]!)).toEqual([{
      code: STROKE_WIDTH_RULE, severity: 'warning', iconId: id(2), nodeId: id(3),
      message: 'Stroke width 2.5 differs from set width 1.75',
    }]);
    expect(project).toEqual(before);
  });

  it('respects per-icon severity and ignores hidden or unpainted strokes', () => {
    const icon = { ...project.icons[0]!, ruleOverrides: { [STROKE_WIDTH_RULE]: 'error' as const } };
    expect(validateIconRules(project, icon)[0]?.severity).toBe('error');
    expect(validateIconRules(project, { ...icon,
      ruleOverrides: { [STROKE_WIDTH_RULE]: 'off' } })).toEqual([]);
    expect(validateIconRules(project, { ...icon, nodes: [{ ...line, visible: false }] })).toEqual([]);
    expect(validateIconRules(project, { ...icon, nodes: [{ ...line,
      stroke: { ...stroke, paint: { kind: 'none' } } }] })).toEqual([]);
  });
});
