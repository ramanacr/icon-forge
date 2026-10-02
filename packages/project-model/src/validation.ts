import type { ProjectV1, SceneNodeV1 } from './types.js';
import validate from './project.validator.mjs';
import { quantize } from './quantization.js';

export function assertProject(input: unknown): ProjectV1 {
  if (!validate(input)) {
    throw new TypeError(`Invalid project: ${validate.errors?.map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  }
  const project = input as ProjectV1;
  if (project.revision < 0 || !Number.isInteger(project.revision)) throw new TypeError('Invalid revision');
  if (project.extensions && Object.keys(project.extensions).some(key => !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(key))) {
    throw new TypeError('Extension keys must be namespaced');
  }
  function checkCoordinates(value: unknown, key = ''): void {
    if (typeof value === 'number') {
      const places = key === 'matrix-linear' ? 6 : 3;
      if (quantize(value, places) !== value) throw new TypeError(`Unquantized number: ${value}`);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => checkCoordinates(item, key === 'transform' && index < 4 ? 'matrix-linear' : ''));
    } else if (value !== null && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) {
        if (childKey !== 'extensions') checkCoordinates(childValue, childKey);
      }
    }
  }
  checkCoordinates(project);
  const ids = new Set<string>();
  const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  function addId(id: string): void {
    if (!uuidV7.test(id) || ids.has(id)) throw new TypeError(`Invalid or duplicate id: ${id}`);
    ids.add(id);
  }
  function checkSlug(name: string): void {
    if (name.length > 64 || !slug.test(name)) throw new TypeError(`Invalid slug: ${name}`);
  }
  addId(project.id);
  const components = new Map(project.components.map(component => [component.id, component]));
  function checkNodes(nodes: SceneNodeV1[], depth: number): void {
    if (depth > 32) throw new TypeError('Scene nesting exceeds 32');
    for (const node of nodes) {
      addId(node.id);
      if (node.type === 'group') checkNodes(node.children, depth + 1);
      if (node.type === 'instance') {
        const component = components.get(node.componentId);
        if (!component) throw new TypeError(`Missing component: ${node.componentId}`);
      }
    }
  }
  for (const token of project.tokens) {
    if (token.name === 'currentColor') throw new TypeError('currentColor cannot be redefined');
  }
  for (const component of project.components) {
    addId(component.id);
    checkSlug(component.name);
  }
  for (const component of project.components) checkNodes(component.nodes, 0);
  function checkComponentCycles(id: string, active: Set<string>, complete: Set<string>): void {
    if (active.has(id)) throw new TypeError('Component cycle');
    if (complete.has(id)) return;
    active.add(id);
    const visit = (nodes: SceneNodeV1[]): void => {
      for (const node of nodes) {
        if (node.type === 'group') visit(node.children);
        if (node.type === 'instance') checkComponentCycles(node.componentId, active, complete);
      }
    };
    visit(components.get(id)!.nodes);
    active.delete(id);
    complete.add(id);
  }
  const checkedComponents = new Set<string>();
  for (const component of project.components) checkComponentCycles(component.id, new Set(), checkedComponents);
  const names = new Set<string>();
  for (const icon of project.icons) {
    addId(icon.id);
    checkSlug(icon.name);
    if (names.has(icon.name)) throw new TypeError(`Duplicate icon name: ${icon.name}`);
    names.add(icon.name);
    for (const alias of icon.aliases) checkSlug(alias);
    checkNodes(icon.nodes, 0);
    for (const variant of icon.variants) {
      addId(variant.id);
      checkSlug(variant.name);
    }
  }
  for (const profile of project.exportProfiles) { addId(profile.id); checkSlug(profile.name); }
  for (const provenance of project.provenance) addId(provenance.id);
  for (const icon of project.icons) {
    for (const id of icon.provenanceIds) {
      if (!project.provenance.some(record => record.id === id)) throw new TypeError(`Missing provenance: ${id}`);
    }
  }
  return project;
}
