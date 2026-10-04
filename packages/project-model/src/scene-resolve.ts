import type { IconV1, ProjectV1, SceneNodeV1 } from './types.js';

/** Apply ordered variant overrides to a detached scene. */
export function resolveVariantNodes(icon: IconV1, variantId: string | undefined): SceneNodeV1[] {
  if (variantId === undefined) return structuredClone(icon.nodes);
  const variant = icon.variants.find(candidate => candidate.id === variantId);
  if (!variant) throw new TypeError('svg.variant.not-found');
  const nodes = structuredClone(icon.nodes);
  for (const override of variant.overrides) {
    const apply = (siblings: SceneNodeV1[]): boolean => {
      for (const [index, node] of siblings.entries()) {
        if (node.id === override.nodeId) {
          if (override.op === 'hide') siblings[index] = { ...node, visible: false };
          else if (override.op === 'replaceNode') siblings[index] = structuredClone(override.node);
          else if (override.op === 'setTransform') siblings[index] = { ...node, transform: [...override.transform] } as SceneNodeV1;
          else if (override.op === 'setStroke') {
            if (!['path', 'rect', 'ellipse', 'line', 'polyline'].includes(node.type)) throw new TypeError('svg.variant.incompatible');
            siblings[index] = { ...node, stroke: override.stroke ?? undefined } as SceneNodeV1;
          } else {
            if (!['path', 'rect', 'ellipse', 'polyline'].includes(node.type)) throw new TypeError('svg.variant.incompatible');
            siblings[index] = { ...node, fill: override.fill ?? undefined } as SceneNodeV1;
          }
          return true;
        }
        if (node.type === 'group' && apply(node.children)) return true;
      }
      return false;
    };
    if (!apply(nodes)) throw new TypeError('svg.variant.target-missing');
  }
  return nodes;
}

/** Resolve one instance's parameter bindings without changing stored component nodes. */
export function instantiateComponentNodes(project: ProjectV1, instance: Extract<SceneNodeV1, { type: 'instance' }>): SceneNodeV1[] {
  const component = project.components.find(candidate => candidate.id === instance.componentId);
  if (!component) throw new TypeError('svg.instance.missing-component');
  if (component.parameters.some(parameter => !component.bindings?.some(binding => binding.parameter === parameter.name))) {
    throw new TypeError('svg.instance.parameters-unbound');
  }
  const nodes = structuredClone(component.nodes);
  const findNode = (siblings: SceneNodeV1[], id: string): SceneNodeV1 | undefined => {
    for (const child of siblings) {
      if (child.id === id) return child;
      if (child.type === 'group') {
        const found = findNode(child.children, id);
        if (found) return found;
      }
    }
    return undefined;
  };
  for (const binding of component.bindings ?? []) {
    const parameter = component.parameters.find(candidate => candidate.name === binding.parameter)!;
    const value = instance.arguments[parameter.name] ?? parameter.default;
    const target = findNode(nodes, binding.nodeId)!;
    if (binding.field === 'visible') target.visible = value as boolean;
    else if (binding.field === 'stroke.width') {
      if (typeof value !== 'number' || value < 0) throw new TypeError('svg.instance.argument.invalid-geometry');
      if ('stroke' in target && target.stroke) target.stroke.width = value;
    } else if (binding.field === 'rx' || binding.field === 'ry') {
      if (typeof value !== 'number' || value < 0 || (target.type === 'rect'
        && value > (binding.field === 'rx' ? target.width : target.height) / 2)) {
        throw new TypeError('svg.instance.argument.invalid-geometry');
      }
      if (target.type === 'rect' || target.type === 'ellipse') target[binding.field] = value;
    }
  }
  return nodes;
}
