import {
  assertProject, canonicalJson, canonicalNumber, quantize,
  type IconV1, type PaintV1, type ProjectV1, type SceneNodeV1, type StrokeV1, type SubpathV1,
} from '@iconforge/project-model';

export interface SvgSerializeOptions {
  precision: 0 | 1 | 2 | 3;
  sizeAttrs: boolean;
  paintMode: 'currentColor' | 'tokens' | 'resolved';
  metadata: boolean;
  theme?: 'light' | 'dark';
  variantId?: string;
}

function resolvedNodes(icon: IconV1, variantId: string | undefined): SceneNodeV1[] {
  if (variantId === undefined) return icon.nodes;
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

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

export function serializeIconSvg(projectInput: ProjectV1, iconInput: IconV1, options: SvgSerializeOptions): string {
  const project = assertProject(projectInput);
  const icon = project.icons.find(candidate => candidate.id === iconInput.id);
  if (!icon || canonicalJson(icon) !== canonicalJson(iconInput)) throw new TypeError('svg.icon.not-in-project');
  const number = (value: number, places: number = options.precision): string => canonicalNumber(quantize(value, places));
  const attr = (name: string, value: string): string => ` ${name}="${escapeXml(value)}"`;
  const paint = (value: PaintV1): string => {
    if (value.kind === 'none') return 'none';
    if (value.kind === 'color') return value.value;
    if (value.token === 'currentColor' || options.paintMode === 'currentColor') return 'currentColor';
    if (options.paintMode === 'tokens') return `var(--if-${value.token})`;
    const token = project.tokens.find(candidate => candidate.name === value.token);
    if (!token) throw new TypeError('svg.paint.missing-token');
    return options.theme === 'dark' ? token.dark ?? token.light : token.light;
  };
  const stroke = (value: StrokeV1): string =>
    attr('stroke', paint(value.paint)) + attr('stroke-width', number(value.width))
    + attr('stroke-linecap', value.cap) + attr('stroke-linejoin', value.join)
    + attr('stroke-miterlimit', number(value.miterLimit))
    + (value.dash ? attr('stroke-dasharray', value.dash.map(dash => number(dash)).join(' ')) : '');
  const drawing = (node: SceneNodeV1): string => {
    if (!node.visible) return '';
    const shared = (node.transform ? attr('transform', `matrix(${node.transform.map((part, index) => number(part, index < 4 ? 6 : options.precision)).join(' ')})`) : '')
      + (node.opacity === undefined ? '' : attr('opacity', number(node.opacity)));
    if (node.type === 'group') return `<g${shared}>${node.children.map(drawing).join('')}</g>`;
    if (node.type === 'instance') {
      const component = project.components.find(candidate => candidate.id === node.componentId);
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
        const value = node.arguments[parameter.name] ?? parameter.default;
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
      return `<g${shared}>${nodes.map(drawing).join('')}</g>`;
    }
    const fill = 'fill' in node && node.fill ? attr('fill', paint(node.fill)) : attr('fill', 'none');
    const outline = 'stroke' in node && node.stroke ? stroke(node.stroke) : '';
    if (node.type === 'path') {
      const path = node.path.map(subpath => pathData(subpath, options.precision, number)).join('');
      return `<path${attr('d', path)}${shared}${fill}${outline}${attr('fill-rule', node.fillRule)}/>`;
    }
    if (node.type === 'rect') return `<rect${attr('x', number(node.x))}${attr('y', number(node.y))}${attr('width', number(node.width))}${attr('height', number(node.height))}${attr('rx', number(node.rx))}${attr('ry', number(node.ry))}${shared}${fill}${outline}/>`;
    if (node.type === 'ellipse') return `<ellipse${attr('cx', number(node.cx))}${attr('cy', number(node.cy))}${attr('rx', number(node.rx))}${attr('ry', number(node.ry))}${shared}${fill}${outline}/>`;
    if (node.type === 'line') return `<line${attr('x1', number(node.x1))}${attr('y1', number(node.y1))}${attr('x2', number(node.x2))}${attr('y2', number(node.y2))}${shared}${outline}/>`;
    const points = [];
    for (let index = 0; index < node.points.length; index += 2) points.push(`${number(node.points[index]!)} ${number(node.points[index + 1]!)}`);
    const tag = node.closed ? 'polygon' : 'polyline';
    return `<${tag}${attr('points', points.join(' '))}${shared}${fill}${outline}/>`;
  };
  const [x, y, width, height] = icon.viewBox;
  let root = `<svg xmlns="http://www.w3.org/2000/svg"${attr('viewBox', [x, y, width, height].map(value => canonicalNumber(value)).join(' '))}`;
  if (options.sizeAttrs) root += attr('width', canonicalNumber(width)) + attr('height', canonicalNumber(height));
  if (icon.accessibility.kind === 'decorative') root += ' aria-hidden="true">';
  else root += ' role="img">' + `<title>${escapeXml(icon.accessibility.label ?? icon.name)}</title>`;
  if (options.metadata) {
    const records = project.provenance.filter(record => icon.provenanceIds.includes(record.id));
    root += `<metadata>${escapeXml(canonicalJson(records))}</metadata>`;
  }
  return `${root}${resolvedNodes(icon, options.variantId).map(drawing).join('')}</svg>\n`;
}

function pathData(subpath: SubpathV1, precision: number, number: (value: number, places?: number) => string): string {
  const endpoint = (segment: SubpathV1['segments'][number]): [number, number] => segment.to;
  let places = precision;
  if (subpath.closed && subpath.segments.length > 0) {
    let previous = subpath.start;
    for (const segment of subpath.segments) {
      const next = endpoint(segment);
      if ((previous[0] !== next[0] || previous[1] !== next[1])
        && number(previous[0], places) === number(next[0], places)
        && number(previous[1], places) === number(next[1], places)) { places = 3; break; }
      previous = next;
    }
  }
  const pair = (point: [number, number]): string => `${number(point[0], places)} ${number(point[1], places)}`;
  let result = `M${pair(subpath.start)}`;
  for (const segment of subpath.segments) {
    if (segment.k === 'L') result += `L${pair(segment.to)}`;
    else if (segment.k === 'Q') result += `Q${pair(segment.c)} ${pair(segment.to)}`;
    else result += `C${pair(segment.c1)} ${pair(segment.c2)} ${pair(segment.to)}`;
  }
  return result + (subpath.closed ? 'Z' : '');
}
