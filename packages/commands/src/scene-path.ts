import type { IconV1, SceneNodeV1, UUID } from '@iconforge/project-model';

/** An icon-local path such as ['nodes', '1', 'children', '0']. */
export function findNodePath(icon: IconV1, id: UUID): string[] | null {
  const walk = (nodes: SceneNodeV1[], prefix: string[]): string[] | null => {
    for (const [index, node] of nodes.entries()) {
      const path = [...prefix, String(index)];
      if (node.id === id) return path;
      if (node.type === 'group') {
        const found = walk(node.children, [...path, 'children']);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(icon.nodes, ['nodes']);
}

export function nodeArrayAt(icon: IconV1, path: readonly string[]): SceneNodeV1[] {
  if (path[0] !== 'nodes' || path.length % 2 !== 1) throw new TypeError('node.path.invalid');
  let nodes = icon.nodes;
  for (let offset = 1; offset < path.length; offset += 2) {
    const index = Number(path[offset]);
    if (path[offset + 1] !== 'children' || !Number.isSafeInteger(index) || index < 0 || index >= nodes.length) {
      throw new TypeError('node.path.invalid');
    }
    const parent = nodes[index]!;
    if (parent.type !== 'group') throw new TypeError('node.parent.invalid');
    nodes = parent.children;
  }
  return nodes;
}

/** True when a node path descends through a locked group. */
export function hasLockedAncestor(icon: IconV1, path: readonly string[]): boolean {
  let nodes = icon.nodes;
  for (let offset = 1; offset < path.length - 1; offset += 2) {
    const node = nodes[Number(path[offset])];
    if (!node || node.type !== 'group') throw new TypeError('node.path.invalid');
    if (node.locked) return true;
    nodes = node.children;
  }
  return false;
}

export function removalOrder(left: readonly string[], right: readonly string[]): number {
  const length = Math.min(left.length, right.length);
  for (let offset = 1; offset < length; offset += 2) {
    const difference = Number(right[offset]) - Number(left[offset]);
    if (difference !== 0) return difference;
  }
  return right.length - left.length;
}
