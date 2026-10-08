import { describe, expect, it } from 'vitest';
import type { ProjectV1, SceneNodeV1 } from '@iconforge/project-model';
import { SAFE_AREA_RULE, STROKE_CAP_RULE, STROKE_JOIN_RULE, STROKE_MITER_LIMIT_RULE,
  STROKE_WIDTH_RULE, proposeRuleFix,
  validateIconRules } from './index.js';

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

  it('locates safe area violations, respects overrides, and ignores hidden geometry', () => {
    const outside = { ...line, x1: 1, stroke: { ...stroke,
      width: 1.75 } };
    const icon = { ...project.icons[0]!, nodes: [outside] };
    expect(validateIconRules(project, icon)).toEqual([{
      code: SAFE_AREA_RULE, severity: 'warning', iconId: id(2), nodeId: id(3),
      message: 'Visible geometry crosses the set safe area',
    }]);
    expect(validateIconRules(project, { ...icon,
      ruleOverrides: { [SAFE_AREA_RULE]: 'off' } })).toEqual([]);
    expect(validateIconRules(project, { ...icon, nodes: [{ ...outside, visible: false }] })).toEqual([]);
    expect(validateIconRules(project, { ...icon, nodes: [{ ...outside, x1: 2 }] })).toEqual([]);
  });

  it('finds mismatched stroke caps and joins at the offending scene node', () => {
    const icon = { ...project.icons[0]!, nodes: [{ ...line,
      stroke: { ...stroke, width: 1.75, cap: 'square' as const, join: 'bevel' as const } }] };
    expect(validateIconRules(project, icon)).toEqual([
      { code: STROKE_CAP_RULE, severity: 'warning', iconId: id(2), nodeId: id(3),
        message: 'Stroke cap square differs from set cap round' },
      { code: STROKE_JOIN_RULE, severity: 'warning', iconId: id(2), nodeId: id(3),
        message: 'Stroke join bevel differs from set join round' },
    ]);
    expect(validateIconRules(project, { ...icon,
      ruleOverrides: { [STROKE_CAP_RULE]: 'off', [STROKE_JOIN_RULE]: 'error' } })).toEqual([
      { code: STROKE_JOIN_RULE, severity: 'error', iconId: id(2), nodeId: id(3),
        message: 'Stroke join bevel differs from set join round' },
    ]);
  });

  it('reports and fixes a miter limit only where the stroke uses a miter join', () => {
    const miter = { ...line, stroke: { ...stroke, width: 1.75, join: 'miter' as const, miterLimit: 8 } };
    const icon = { ...project.icons[0]!, nodes: [miter],
      ruleOverrides: { [STROKE_JOIN_RULE]: 'off' as const } };
    const diagnostic = validateIconRules(project, icon);
    expect(diagnostic).toEqual([{ code: STROKE_MITER_LIMIT_RULE, severity: 'warning',
      iconId: id(2), nodeId: id(3), message: 'Stroke miter limit 8 differs from set miter limit 4' }]);
    const current = { ...project, icons: [icon] };
    expect(proposeRuleFix(current, diagnostic[0]!)).toEqual({ type: 'node.update', payload: {
      iconId: id(2), nodeId: id(3), ops: [{ op: 'setStroke', stroke: { ...miter.stroke, miterLimit: 4 } }],
    } });
    expect(validateIconRules(project, { ...icon, nodes: [{ ...miter,
      stroke: { ...miter.stroke, join: 'round' } }] })).toEqual([]);
    expect(validateIconRules(project, { ...icon,
      ruleOverrides: { ...icon.ruleOverrides, [STROKE_MITER_LIMIT_RULE]: 'off' },
    })).toEqual([]);
  });

  it('proposes a current stroke update without changing the source and rejects stale or unsafe targets', () => {
    const before = structuredClone(project);
    const diagnostic = validateIconRules(project, project.icons[0]!)[0]!;
    expect(proposeRuleFix(project, diagnostic)).toEqual({ type: 'node.update', payload: {
      iconId: id(2), nodeId: id(3), ops: [{ op: 'setStroke', stroke: { ...stroke, width: 1.75 } }],
    } });
    expect(project).toEqual(before);
    const changed = structuredClone(project);
    (changed.icons[0]!.nodes[0] as typeof line).stroke = { ...stroke, width: 1.75 };
    expect(proposeRuleFix(changed, diagnostic)).toBeNull();
    const locked = structuredClone(project);
    locked.icons[0]!.nodes[0]!.locked = true;
    expect(proposeRuleFix(locked, diagnostic)).toBeNull();
    const grouped = structuredClone(project);
    grouped.icons[0]!.nodes = [{ id: id(4), type: 'group', visible: true, locked: true,
      children: [line] }];
    expect(proposeRuleFix(grouped, diagnostic)).toBeNull();
    expect(proposeRuleFix(project, { ...diagnostic, code: SAFE_AREA_RULE })).toBeNull();
  });
});
