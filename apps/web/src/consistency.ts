import type { IconV1, ProjectV1, Severity } from '@iconforge/project-model';
import { STROKE_WIDTH_RULE, validateIconRules } from '@iconforge/rules';

export { STROKE_WIDTH_RULE };

export interface IconConsistencyWarning {
  code: typeof STROKE_WIDTH_RULE;
  severity: Exclude<Severity, 'off'>;
  count: number;
  message: string;
}

/** Read-only check of the base icon scene against its set stroke policy. */
export function iconConsistencyWarnings(project: ProjectV1, icon: IconV1): IconConsistencyWarning[] {
  const diagnostics = validateIconRules(project, icon).filter(item => item.code === STROKE_WIDTH_RULE);
  const count = diagnostics.length;
  const expected = project.designSystem.stroke.width;
  return count ? [{ code: STROKE_WIDTH_RULE, severity: diagnostics[0]!.severity, count,
    message: `${count} stroke ${count === 1 ? 'width differs' : 'widths differ'} from set width ${expected}` }] : [];
}
