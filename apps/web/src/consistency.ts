import { instantiateComponentNodes, type IconV1, type ProjectV1, type SceneNodeV1, type Severity } from '@iconforge/project-model';

export const STROKE_WIDTH_RULE = 'rule.stroke-width-mismatch';

export interface IconConsistencyWarning {
  code: typeof STROKE_WIDTH_RULE;
  severity: Exclude<Severity, 'off'>;
  count: number;
  message: string;
}

/** Read-only check of the base icon scene against its set stroke policy. */
export function iconConsistencyWarnings(project: ProjectV1, icon: IconV1): IconConsistencyWarning[] {
  const severity = icon.ruleOverrides?.[STROKE_WIDTH_RULE]
    ?? project.designSystem.severities[STROKE_WIDTH_RULE] ?? 'warning';
  if (severity === 'off') return [];
  const expected = project.designSystem.stroke.width;
  let count = 0;
  const visit = (nodes: SceneNodeV1[]): void => {
    for (const node of nodes) {
      if (!node.visible) continue;
      if (node.type === 'group') visit(node.children);
      else if (node.type === 'instance') visit(instantiateComponentNodes(project, node));
      else if (node.stroke && node.stroke.paint.kind !== 'none'
        && Math.abs(node.stroke.width - expected) > 0.001) count++;
    }
  };
  visit(icon.nodes);
  return count ? [{ code: STROKE_WIDTH_RULE, severity, count,
    message: `${count} stroke ${count === 1 ? 'width differs' : 'widths differ'} from set width ${expected}` }] : [];
}
