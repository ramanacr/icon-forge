import { canonicalJson, type ProjectV1 } from '@iconforge/project-model';
import type { StructuralPatch } from '@iconforge/commands';

/** Apply the project-owned structural patch subset currently emitted by handlers. */
export function applyPatches(project: ProjectV1 | null, patches: readonly StructuralPatch[]): ProjectV1 | null {
  let current = project;
  for (const patch of patches) {
    if (patch.path[0] === 'icons' && patch.path.length >= 2) {
      if (current === null || !/^(0|[1-9]\d*)$/.test(patch.path[1]!)) throw new TypeError('patch.conflict');
      const index = Number(patch.path[1]);
      const icons = structuredClone(current.icons);
      if (patch.path.length === 2 && patch.op === 'insert') {
        if (index > icons.length) throw new TypeError('patch.conflict');
        icons.splice(index, 0, structuredClone(patch.value as ProjectV1['icons'][number]));
      } else if (patch.path.length === 2 && patch.op === 'remove') {
        if (index >= icons.length || canonicalJson(icons[index]) !== canonicalJson(patch.value)) throw new TypeError('patch.conflict');
        icons.splice(index, 1);
      } else if (patch.path.length === 3 && patch.path[2] === 'name' && patch.op === 'replace') {
        if (index >= icons.length || icons[index]!.name !== patch.before || typeof patch.after !== 'string') {
          throw new TypeError('patch.conflict');
        }
        icons[index] = { ...icons[index]!, name: patch.after };
      } else if (patch.path.length === 3 && ['aliases', 'tags', 'accessibility', 'font'].includes(patch.path[2]!)) {
        if (index >= icons.length) throw new TypeError('patch.conflict');
        const field = patch.path[2]! as 'aliases' | 'tags' | 'accessibility' | 'font';
        const icon = icons[index]!;
        const present = Object.hasOwn(icon, field);
        const value = icon[field];
        if (patch.op === 'replace') {
          if (!present || canonicalJson(value) !== canonicalJson(patch.before)) throw new TypeError('patch.conflict');
          icons[index] = { ...icon, [field]: structuredClone(patch.after) };
        } else if (patch.op === 'insert' && field === 'font') {
          if (present) throw new TypeError('patch.conflict');
          icons[index] = { ...icon, font: structuredClone(patch.value as NonNullable<typeof icon.font>) };
        } else if (patch.op === 'remove' && field === 'font') {
          if (!present || canonicalJson(value) !== canonicalJson(patch.value)) throw new TypeError('patch.conflict');
          const { font: _removed, ...withoutFont } = icon;
          icons[index] = withoutFont;
        } else {
          throw new TypeError('patch.op.unsupported');
        }
      } else {
        throw new TypeError('patch.path.unsupported');
      }
      current = { ...current, icons };
    } else if (patch.path[0] === 'tokens' && patch.path.length === 2) {
      if (current === null || !/^(0|[1-9]\d*)$/.test(patch.path[1]!)) throw new TypeError('patch.conflict');
      const index = Number(patch.path[1]);
      const tokens = structuredClone(current.tokens);
      if (patch.op === 'insert') {
        if (index > tokens.length) throw new TypeError('patch.conflict');
        tokens.splice(index, 0, structuredClone(patch.value as ProjectV1['tokens'][number]));
      } else if (patch.op === 'remove') {
        if (index >= tokens.length || canonicalJson(tokens[index]) !== canonicalJson(patch.value)) throw new TypeError('patch.conflict');
        tokens.splice(index, 1);
      } else if (patch.op === 'replace') {
        if (index >= tokens.length || canonicalJson(tokens[index]) !== canonicalJson(patch.before)) throw new TypeError('patch.conflict');
        tokens[index] = structuredClone(patch.after as ProjectV1['tokens'][number]);
      } else {
        throw new TypeError('patch.op.unsupported');
      }
      current = { ...current, tokens };
    } else if (patch.path[0] === 'exportProfiles' && patch.path.length === 2) {
      if (current === null || !/^(0|[1-9]\d*)$/.test(patch.path[1]!)) throw new TypeError('patch.conflict');
      const index = Number(patch.path[1]);
      const profiles = structuredClone(current.exportProfiles);
      if (patch.op === 'insert') {
        if (index > profiles.length) throw new TypeError('patch.conflict');
        profiles.splice(index, 0, structuredClone(patch.value as ProjectV1['exportProfiles'][number]));
      } else if (patch.op === 'remove') {
        if (index >= profiles.length || canonicalJson(profiles[index]) !== canonicalJson(patch.value)) throw new TypeError('patch.conflict');
        profiles.splice(index, 1);
      } else if (patch.op === 'replace') {
        if (index >= profiles.length || canonicalJson(profiles[index]) !== canonicalJson(patch.before)) throw new TypeError('patch.conflict');
        profiles[index] = structuredClone(patch.after as ProjectV1['exportProfiles'][number]);
      } else {
        throw new TypeError('patch.op.unsupported');
      }
      current = { ...current, exportProfiles: profiles };
    } else if (patch.op !== 'replace') {
      throw new TypeError('patch.op.unsupported');
    } else if (patch.path.length === 0) {
      if ((current === null) !== (patch.before === null)) throw new TypeError('patch.conflict');
      current = patch.after === null ? null : structuredClone(patch.after as ProjectV1);
    } else if (patch.path.length === 1 && patch.path[0] === 'name') {
      if (current === null || current.name !== patch.before || typeof patch.after !== 'string') {
        throw new TypeError('patch.conflict');
      }
      current = { ...current, name: patch.after };
    } else if (patch.path.length === 1 && patch.path[0] === 'designSystem') {
      if (current === null || canonicalJson(current.designSystem) !== canonicalJson(patch.before)) throw new TypeError('patch.conflict');
      current = { ...current, designSystem: structuredClone(patch.after as ProjectV1['designSystem']) };
    } else {
      throw new TypeError('patch.path.unsupported');
    }
  }
  return current;
}
