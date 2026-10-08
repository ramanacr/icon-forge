import { instantiateComponentNodes, type IconV1, type ProjectV1, type SceneNodeV1, type Severity,
  type StrokeV1 } from '@iconforge/project-model';
import { nodeGeometryBounds } from '@iconforge/geometry';

export const STROKE_WIDTH_RULE = 'rule.stroke-width-mismatch';
export const SAFE_AREA_RULE = 'rule.safe-area';
export const STROKE_CAP_RULE = 'rule.stroke-cap-mismatch';
export const STROKE_JOIN_RULE = 'rule.stroke-join-mismatch';

export interface RuleDiagnostic {
  code: string;
  severity: Exclude<Severity, 'off'>;
  iconId: string;
  nodeId: string;
  message: string;
}

export interface RuleFixProposal {
  type: 'node.update';
  payload: { iconId: string; nodeId: string; ops: [{ op: 'setStroke'; stroke: StrokeV1 }] };
}

export interface RuleDefinition {
  code: string;
  defaultSeverity: Exclude<Severity, 'off'>;
  check(project: ProjectV1, icon: IconV1, severity: Exclude<Severity, 'off'>): RuleDiagnostic[];
}

function visitPaintedStrokes(project: ProjectV1, icon: IconV1,
  visitStroke: (stroke: StrokeV1, nodeId: string) => void): void {
  const visit = (nodes: SceneNodeV1[], instanceId?: string): void => {
    for (const node of nodes) {
      if (!node.visible) continue;
      if (node.type === 'group') visit(node.children, instanceId);
      else if (node.type === 'instance') visit(instantiateComponentNodes(project, node), instanceId ?? node.id);
      else if (node.stroke && node.stroke.paint.kind !== 'none') {
        visitStroke(node.stroke, instanceId ?? node.id);
      }
    }
  };
  visit(icon.nodes);
}

const strokeWidthRule: RuleDefinition = {
  code: STROKE_WIDTH_RULE,
  defaultSeverity: 'warning',
  check(project, icon, severity) {
    const expected = project.designSystem.stroke.width;
    const diagnostics: RuleDiagnostic[] = [];
    visitPaintedStrokes(project, icon, (stroke, nodeId) => {
      if (Math.abs(stroke.width - expected) > 0.001) {
        diagnostics.push({ code: STROKE_WIDTH_RULE, severity, iconId: icon.id, nodeId,
          message: `Stroke width ${stroke.width} differs from set width ${expected}` });
      }
    });
    return diagnostics;
  },
};

function strokePropertyRule(code: string, property: 'cap' | 'join'): RuleDefinition {
  return { code, defaultSeverity: 'warning', check(project, icon, severity) {
    const expected = project.designSystem.stroke[property];
    const diagnostics: RuleDiagnostic[] = [];
    visitPaintedStrokes(project, icon, (stroke, nodeId) => {
      if (stroke[property] !== expected) {
        diagnostics.push({ code, severity, iconId: icon.id, nodeId,
          message: `Stroke ${property} ${stroke[property]} differs from set ${property} ${expected}` });
      }
    });
    return diagnostics;
  } };
}

const safeAreaRule: RuleDefinition = {
  code: SAFE_AREA_RULE,
  defaultSeverity: 'warning',
  check(project, icon, severity) {
    const [x, y, width, height] = icon.viewBox;
    const { left, right, top, bottom } = project.designSystem.safeArea;
    const minX = x + left;
    const maxX = x + width - right;
    const minY = y + top;
    const maxY = y + height - bottom;
    return icon.nodes.flatMap(node => {
      const bounds = nodeGeometryBounds(project, node);
      if (!bounds || (bounds.minX >= minX && bounds.maxX <= maxX
        && bounds.minY >= minY && bounds.maxY <= maxY)) return [];
      return [{ code: SAFE_AREA_RULE, severity, iconId: icon.id, nodeId: node.id,
        message: 'Visible geometry crosses the set safe area' }];
    });
  },
};

export const RULES: readonly RuleDefinition[] = [strokeWidthRule,
  strokePropertyRule(STROKE_CAP_RULE, 'cap'), strokePropertyRule(STROKE_JOIN_RULE, 'join'), safeAreaRule];

/** Deterministic, read-only diagnostics with a scene location for each violation. */
export function validateIconRules(project: ProjectV1, icon: IconV1): RuleDiagnostic[] {
  return RULES.flatMap(rule => {
    const severity = icon.ruleOverrides?.[rule.code]
      ?? project.designSystem.severities[rule.code] ?? rule.defaultSeverity;
    return severity === 'off' ? [] : rule.check(project, icon, severity);
  });
}

/** A typed command proposal for a current, directly editable stroke violation. */
export function proposeRuleFix(project: ProjectV1, diagnostic: RuleDiagnostic): RuleFixProposal | null {
  if (![STROKE_WIDTH_RULE, STROKE_CAP_RULE, STROKE_JOIN_RULE].includes(diagnostic.code)) return null;
  const icon = project.icons.find(candidate => candidate.id === diagnostic.iconId);
  if (!icon || !validateIconRules(project, icon).some(current => current.code === diagnostic.code
    && current.nodeId === diagnostic.nodeId && current.message === diagnostic.message
    && current.severity === diagnostic.severity)) return null;
  return proposeFixForValidatedDiagnostic(project, diagnostic);
}

/** Use only with a diagnostic returned by validateIconRules for this same project snapshot. */
export function proposeFixForValidatedDiagnostic(project: ProjectV1,
  diagnostic: RuleDiagnostic): RuleFixProposal | null {
  if (![STROKE_WIDTH_RULE, STROKE_CAP_RULE, STROKE_JOIN_RULE].includes(diagnostic.code)) return null;
  const icon = project.icons.find(candidate => candidate.id === diagnostic.iconId);
  if (!icon) return null;
  const find = (nodes: SceneNodeV1[], lockedParent = false): SceneNodeV1 | null => {
    for (const node of nodes) {
      if (node.id === diagnostic.nodeId) return lockedParent || node.locked ? null : node;
      if (node.type === 'group') {
        const found = find(node.children, lockedParent || node.locked);
        if (found) return found;
      }
    }
    return null;
  };
  const node = find(icon.nodes);
  if (!node || node.type === 'group' || node.type === 'instance' || !node.stroke) return null;
  const stroke = structuredClone(node.stroke);
  if (diagnostic.code === STROKE_WIDTH_RULE) stroke.width = project.designSystem.stroke.width;
  else if (diagnostic.code === STROKE_CAP_RULE) stroke.cap = project.designSystem.stroke.cap;
  else stroke.join = project.designSystem.stroke.join;
  return { type: 'node.update', payload: { iconId: icon.id, nodeId: node.id,
    ops: [{ op: 'setStroke', stroke }] } };
}
