import type { IconV1, ProjectV1, SceneNodeV1, UUID } from '@iconforge/project-model';

function visitNodes(nodes: SceneNodeV1[], visit: (id: UUID) => void): void {
  for (const node of nodes) {
    visit(node.id);
    if (node.type === 'group') visitNodes(node.children, visit);
  }
}

function visitIconIds(icon: IconV1, visit: (id: UUID) => void): void {
  visit(icon.id);
  visitNodes(icon.nodes, visit);
  for (const variant of icon.variants) {
    visit(variant.id);
    for (const override of variant.overrides) {
      if (override.op === 'replaceNode') visitNodes([override.node], visit);
    }
  }
}

function copyName(project: ProjectV1, source: string): string {
  const taken = new Set(project.icons.map(icon => icon.name));
  for (let ordinal = 1; ; ordinal++) {
    const suffix = ordinal === 1 ? '-copy' : `-copy-${ordinal}`;
    const candidate = `${source.slice(0, 64 - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Clone only icon-owned IDs. Component and provenance references retain their original targets. */
export function duplicateIcon(project: ProjectV1, source: IconV1, newIconId: UUID,
  idMap: Record<UUID, UUID>): IconV1 {
  const owned = new Set<UUID>();
  const baseNodeIds = new Set<UUID>();
  visitNodes(source.nodes, id => { owned.add(id); baseNodeIds.add(id); });
  for (const variant of source.variants) {
    owned.add(variant.id);
    for (const override of variant.overrides) {
      if (!baseNodeIds.has(override.nodeId)) throw new TypeError('icon.duplicate.invalid-override');
      if (override.op === 'replaceNode') visitNodes([override.node], id => owned.add(id));
    }
  }
  const keys = Object.keys(idMap);
  if (keys.length !== owned.size || keys.some(key => !owned.has(key))) throw new TypeError('icon.duplicate.id-map');
  const used = new Set<UUID>([project.id]);
  for (const component of project.components) { used.add(component.id); visitNodes(component.nodes, id => used.add(id)); }
  for (const icon of project.icons) visitIconIds(icon, id => used.add(id));
  for (const profile of project.exportProfiles) used.add(profile.id);
  for (const provenance of project.provenance) used.add(provenance.id);
  const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidV7.test(newIconId) || used.has(newIconId)) throw new TypeError('icon.duplicate.id-map');
  used.add(newIconId);
  for (const key of owned) {
    const value = idMap[key];
    if (!value || !uuidV7.test(value) || used.has(value)) throw new TypeError('icon.duplicate.id-map');
    used.add(value);
  }
  const remap = (id: UUID): UUID => {
    const value = idMap[id];
    if (!value) throw new TypeError('icon.duplicate.id-map');
    return value;
  };
  const copyNodes = (nodes: SceneNodeV1[]): SceneNodeV1[] => nodes.map(node => {
    const copy = structuredClone(node);
    copy.id = remap(node.id);
    if (copy.type === 'group' && node.type === 'group') copy.children = copyNodes(node.children);
    return copy;
  });
  const copy = structuredClone(source);
  copy.id = newIconId;
  copy.name = copyName(project, source.name);
  copy.nodes = copyNodes(source.nodes);
  copy.variants = source.variants.map(variant => ({ ...structuredClone(variant), id: remap(variant.id),
    overrides: variant.overrides.map(override => override.op === 'replaceNode'
      ? { ...structuredClone(override), nodeId: remap(override.nodeId), node: copyNodes([override.node])[0]! }
      : { ...structuredClone(override), nodeId: remap(override.nodeId) }),
  }));
  return copy;
}
