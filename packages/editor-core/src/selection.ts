import type { IconV1, ProjectV1, SceneNodeV1, UUID } from '@iconforge/project-model';

export interface SelectionSnapshot { iconId: UUID | null; nodeIds: UUID[] }

function paths(icon: IconV1): Map<UUID, UUID[]> {
  const result = new Map<UUID, UUID[]>();
  const walk = (nodes: SceneNodeV1[], ancestors: UUID[]): void => {
    for (const node of nodes) {
      result.set(node.id, [...ancestors, node.id]);
      if (node.type === 'group') walk(node.children, [...ancestors, node.id]);
    }
  };
  walk(icon.nodes, []);
  return result;
}

/** Ephemeral scene-order selection. Nothing here is persisted or journaled. */
export class SelectionModel {
  private state: SelectionSnapshot = { iconId: null, nodeIds: [] };

  get snapshot(): SelectionSnapshot { return structuredClone(this.state); }

  replace(project: ProjectV1, iconId: UUID, nodeIds: UUID[]): SelectionSnapshot {
    const icon = project.icons.find(candidate => candidate.id === iconId);
    if (!icon) throw new TypeError('selection.icon.not-found');
    if (new Set(nodeIds).size !== nodeIds.length) throw new TypeError('selection.duplicate');
    const locations = paths(icon);
    for (const id of nodeIds) if (!locations.has(id)) throw new TypeError('selection.node.not-found');
    for (const left of nodeIds) {
      for (const right of nodeIds) {
        if (left !== right && locations.get(right)!.slice(0, -1).includes(left)) {
          throw new TypeError('selection.overlap');
        }
      }
    }
    const selected = new Set(nodeIds);
    this.state = { iconId, nodeIds: [...locations.keys()].filter(id => selected.has(id)) };
    return this.snapshot;
  }

  toggle(project: ProjectV1, iconId: UUID, nodeId: UUID): SelectionSnapshot {
    const current = this.state.iconId === iconId ? this.state.nodeIds : [];
    return this.replace(project, iconId,
      current.includes(nodeId) ? current.filter(id => id !== nodeId) : [...current, nodeId]);
  }

  reconcile(project: ProjectV1): SelectionSnapshot {
    if (this.state.iconId === null) return this.snapshot;
    const icon = project.icons.find(candidate => candidate.id === this.state.iconId);
    if (!icon) return this.clear();
    const available = paths(icon);
    return this.replace(project, icon.id, this.state.nodeIds.filter(id => available.has(id)));
  }

  clear(): SelectionSnapshot {
    this.state = { iconId: null, nodeIds: [] };
    return this.snapshot;
  }
}
