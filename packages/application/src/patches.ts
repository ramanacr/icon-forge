import type { ProjectV1 } from '@iconforge/project-model';
import type { StructuralPatch } from '@iconforge/commands';

/** Apply the project-owned structural patch subset currently emitted by handlers. */
export function applyPatches(project: ProjectV1 | null, patches: readonly StructuralPatch[]): ProjectV1 | null {
  let current = project;
  for (const patch of patches) {
    if (patch.op !== 'replace') throw new TypeError('patch.op.unsupported');
    if (patch.path.length === 0) {
      if ((current === null) !== (patch.before === null)) throw new TypeError('patch.conflict');
      current = patch.after === null ? null : structuredClone(patch.after as ProjectV1);
    } else if (patch.path.length === 1 && patch.path[0] === 'name') {
      if (current === null || current.name !== patch.before || typeof patch.after !== 'string') {
        throw new TypeError('patch.conflict');
      }
      current = { ...current, name: patch.after };
    } else {
      throw new TypeError('patch.path.unsupported');
    }
  }
  return current;
}
