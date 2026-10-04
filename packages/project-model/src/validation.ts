import type { PaintV1, ProjectV1, SceneNodeV1 } from './types.js';
import validate from './project.validator.mjs';
import { quantize } from './quantization.js';

export function assertProject(input: unknown): ProjectV1 {
  if (!validate(input)) {
    throw new TypeError(`Invalid project: ${validate.errors?.map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  }
  const project = input as ProjectV1;
  if (project.name.length < 1 || project.name.length > 120) throw new TypeError('Invalid project name');
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
  const tokenNames = new Set<string>(['currentColor']);
  function checkPaint(paint: PaintV1): void {
    if (paint.kind === 'token' && !tokenNames.has(paint.token)) {
      throw new TypeError(`Missing paint token: ${paint.token}`);
    }
    if (paint.kind === 'color' && !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(paint.value)) {
      throw new TypeError('Invalid literal color');
    }
  }
  const components = new Map(project.components.map(component => [component.id, component]));
  const parametersByComponent = new Map(project.components.map(component => {
    const parameters = new Map<string, typeof component.parameters[number]>();
    for (const parameter of component.parameters) {
      if (!parameter.name.trim() || parameters.has(parameter.name)) throw new TypeError('Component parameter duplicate');
      if (parameter.type !== 'number' && (parameter.min !== undefined || parameter.max !== undefined)) {
        throw new TypeError('Component parameter invalid');
      }
      if (parameter.min !== undefined && parameter.max !== undefined && parameter.min > parameter.max) {
        throw new TypeError('Component parameter invalid');
      }
      const validValue = (value: typeof parameter.default): boolean => typeof value === parameter.type
        && (parameter.type !== 'number' || (typeof value === 'number' && Number.isFinite(value)
          && (parameter.min === undefined || value >= parameter.min)
          && (parameter.max === undefined || value <= parameter.max)));
      if (!validValue(parameter.default)) throw new TypeError('Component parameter invalid');
      parameters.set(parameter.name, parameter);
    }
    const nodesById = new Map<string, SceneNodeV1>();
    const indexNodes = (nodes: SceneNodeV1[]): void => {
      for (const node of nodes) {
        nodesById.set(node.id, node);
        if (node.type === 'group') indexNodes(node.children);
      }
    };
    indexNodes(component.nodes);
    const boundFields = new Set<string>();
    for (const binding of component.bindings ?? []) {
      const parameter = parameters.get(binding.parameter);
      const node = nodesById.get(binding.nodeId);
      const numeric = binding.field !== 'visible';
      if (!parameter || !node || parameter.type !== (numeric ? 'number' : 'boolean')) {
        throw new TypeError('Component binding invalid');
      }
      if (binding.field === 'stroke.width' && (!('stroke' in node) || !node.stroke)
        || (binding.field === 'rx' || binding.field === 'ry') && node.type !== 'rect' && node.type !== 'ellipse') {
        throw new TypeError('Component binding invalid');
      }
      const target = `${binding.nodeId}:${binding.field}`;
      if (boundFields.has(target)) throw new TypeError('Component binding duplicate');
      boundFields.add(target);
    }
    return [component.id, parameters] as const;
  }));
  function checkNodes(nodes: SceneNodeV1[], depth: number): void {
    if (depth > 32) throw new TypeError('Scene nesting exceeds 32');
    for (const node of nodes) {
      addId(node.id);
      if (node.opacity !== undefined && (node.opacity < 0 || node.opacity > 1)) {
        throw new TypeError('Invalid node opacity');
      }
      if (node.type === 'rect' && (node.width < 0 || node.height < 0 || node.rx < 0 || node.ry < 0
        || node.rx > node.width / 2 || node.ry > node.height / 2)) {
        throw new TypeError('Invalid rectangle radii');
      }
      if (node.type === 'polyline' && (node.points.length < 4 || node.points.length % 2 !== 0)) {
        throw new TypeError('Invalid polyline points');
      }
      if ('fill' in node && node.fill) checkPaint(node.fill);
      if ('stroke' in node && node.stroke) checkPaint(node.stroke.paint);
      if (node.type === 'group') checkNodes(node.children, depth + 1);
      if (node.type === 'instance') {
        const component = components.get(node.componentId);
        if (!component) throw new TypeError(`Missing component: ${node.componentId}`);
        const parameters = parametersByComponent.get(node.componentId)!;
        for (const [name, value] of Object.entries(node.arguments)) {
          const parameter = parameters.get(name);
          if (!parameter) throw new TypeError('Component argument unknown');
          if (typeof value !== parameter.type || (parameter.type === 'number' && typeof value === 'number'
            && ((parameter.min !== undefined && value < parameter.min)
              || (parameter.max !== undefined && value > parameter.max)))) {
            throw new TypeError('Component argument invalid');
          }
        }
      }
    }
  }
  for (const token of project.tokens) {
    if (tokenNames.has(token.name)) throw new TypeError(`Duplicate or reserved color token: ${token.name}`);
    if (!/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(token.light)
      || (token.dark !== undefined && !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(token.dark))) {
      throw new TypeError(`Invalid color token: ${token.name}`);
    }
    tokenNames.add(token.name);
  }
  if (!tokenNames.has(project.designSystem.defaultPaintToken)) throw new TypeError('Missing default paint token');
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
    if (icon.viewBox[2] <= 0 || icon.viewBox[3] <= 0) throw new TypeError('Invalid viewBox dimensions');
    if (names.has(icon.name)) throw new TypeError(`Duplicate icon name: ${icon.name}`);
    names.add(icon.name);
    for (const alias of icon.aliases) checkSlug(alias);
    const nodeIds = new Set<string>();
    const collectNodeIds = (nodes: SceneNodeV1[]): void => {
      for (const node of nodes) {
        nodeIds.add(node.id);
        if (node.type === 'group') collectNodeIds(node.children);
      }
    };
    collectNodeIds(icon.nodes);
    checkNodes(icon.nodes, 0);
    for (const variant of icon.variants) {
      addId(variant.id);
      checkSlug(variant.name);
      for (const override of variant.overrides) {
        if (!nodeIds.has(override.nodeId)) throw new TypeError(`Missing variant target: ${override.nodeId}`);
        if (override.op === 'replaceNode') checkNodes([override.node], 0);
        if (override.op === 'setFill' && override.fill) checkPaint(override.fill);
        if (override.op === 'setStroke' && override.stroke) checkPaint(override.stroke.paint);
      }
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
