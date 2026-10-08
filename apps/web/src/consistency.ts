import type { IconV1, ProjectV1, Severity } from '@iconforge/project-model';
import { SAFE_AREA_RULE, STROKE_WIDTH_RULE, validateIconRules } from '@iconforge/rules';

export { STROKE_WIDTH_RULE };

export interface IconConsistencyWarning {
  code: string;
  severity: Exclude<Severity, 'off'>;
  count: number;
  message: string;
}

/** Read-only summary of located rule diagnostics for the set overview. */
export function iconConsistencyWarnings(project: ProjectV1, icon: IconV1): IconConsistencyWarning[] {
  const diagnostics = validateIconRules(project, icon);
  return [STROKE_WIDTH_RULE, SAFE_AREA_RULE].flatMap(code => {
    const matches = diagnostics.filter(item => item.code === code);
    const count = matches.length;
    if (!count) return [];
    const message = code === STROKE_WIDTH_RULE
      ? `${count} stroke ${count === 1 ? 'width differs' : 'widths differ'} from set width ${project.designSystem.stroke.width}`
      : `${count} ${count === 1 ? 'shape crosses' : 'shapes cross'} the set safe area`;
    return [{ code, severity: matches[0]!.severity, count, message }];
  });
}
