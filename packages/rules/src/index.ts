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
