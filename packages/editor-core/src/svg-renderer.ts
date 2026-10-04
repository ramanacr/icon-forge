import {
  assertProject, canonicalJson, canonicalNumber, instantiateComponentNodes, resolveVariantNodes,
  type IconV1, type PaintV1, type ProjectV1, type SceneNodeV1, type StrokeV1, type SubpathV1,
} from '@iconforge/project-model';

const SVG_NS = 'http://www.w3.org/2000/svg';
export interface RenderIconOptions { variantId?: string; theme?: 'light' | 'dark' }

/** Build an interactive SVG DOM tree directly from the validated model. */
export function renderIconSvg(document: Document, input: ProjectV1, iconInput: IconV1,
  options: RenderIconOptions = {}): SVGSVGElement {
  const project = assertProject(input);
  const icon = project.icons.find(candidate => candidate.id === iconInput.id);
  if (!icon || canonicalJson(icon) !== canonicalJson(iconInput)) throw new TypeError('renderer.icon.not-in-project');
  const baseNodeIds = new Set<string>();
  const collectIds = (nodes: SceneNodeV1[]): void => {
    for (const node of nodes) {
      baseNodeIds.add(node.id);
      if (node.type === 'group') collectIds(node.children);
    }
  };
  collectIds(icon.nodes);
  const element = <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] =>
    document.createElementNS(SVG_NS, tag);
  const n = canonicalNumber;
  const paint = (value: PaintV1): string => {
    if (value.kind === 'none') return 'none';
    if (value.kind === 'color') return value.value;
    if (value.token === 'currentColor') return 'currentColor';
    const token = project.tokens.find(candidate => candidate.name === value.token);
    if (!token) throw new TypeError('renderer.paint.missing-token');
    return options.theme === 'dark' ? token.dark ?? token.light : token.light;
  };
  const applyStroke = (target: SVGElement, stroke: StrokeV1): void => {
    target.setAttribute('stroke', paint(stroke.paint));
    target.setAttribute('stroke-width', n(stroke.width));
    target.setAttribute('stroke-linecap', stroke.cap);
    target.setAttribute('stroke-linejoin', stroke.join);
    target.setAttribute('stroke-miterlimit', n(stroke.miterLimit));
    if (stroke.dash) target.setAttribute('stroke-dasharray', stroke.dash.map(n).join(' '));
  };
  const pathData = (path: SubpathV1[]): string => path.map(subpath => {
    const point = (pair: [number, number]): string => `${n(pair[0])} ${n(pair[1])}`;
    let data = `M${point(subpath.start)}`;
    for (const segment of subpath.segments) {
      if (segment.k === 'L') data += `L${point(segment.to)}`;
      else if (segment.k === 'Q') data += `Q${point(segment.c)} ${point(segment.to)}`;
      else data += `C${point(segment.c1)} ${point(segment.c2)} ${point(segment.to)}`;
    }
    return data + (subpath.closed ? 'Z' : '');
  }).join('');
  const drawing = (node: SceneNodeV1, selectable: boolean): SVGElement | null => {
    if (!node.visible) return null;
    const tag = node.type === 'group' || node.type === 'instance' ? 'g'
      : node.type === 'polyline' && node.closed ? 'polygon' : node.type;
    const target = element(tag);
    if (selectable && baseNodeIds.has(node.id)) target.setAttribute('data-node-id', node.id);
    if (node.role) target.setAttribute('data-role', node.role);
    if (node.transform) target.setAttribute('transform', `matrix(${node.transform.map(n).join(' ')})`);
    if (node.opacity !== undefined) target.setAttribute('opacity', n(node.opacity));
    if (node.type === 'group' || node.type === 'instance') {
      const children = node.type === 'group' ? node.children : instantiateComponentNodes(project, node);
      for (const child of children) {
        const rendered = drawing(child, selectable && node.type === 'group');
        if (rendered) target.appendChild(rendered);
      }
      return target;
    }
    if ('fill' in node) target.setAttribute('fill', node.fill ? paint(node.fill) : 'none');
    if ('stroke' in node && node.stroke) applyStroke(target, node.stroke);
    if (node.type === 'path') {
      target.setAttribute('d', pathData(node.path));
      target.setAttribute('fill-rule', node.fillRule);
    } else if (node.type === 'rect') {
      for (const key of ['x', 'y', 'width', 'height', 'rx', 'ry'] as const) target.setAttribute(key, n(node[key]));
    } else if (node.type === 'ellipse') {
      for (const key of ['cx', 'cy', 'rx', 'ry'] as const) target.setAttribute(key, n(node[key]));
    } else if (node.type === 'line') {
      for (const key of ['x1', 'y1', 'x2', 'y2'] as const) target.setAttribute(key, n(node[key]));
    } else {
      const points: string[] = [];
      for (let index = 0; index < node.points.length; index += 2) {
        points.push(`${n(node.points[index]!)} ${n(node.points[index + 1]!)}`);
      }
      target.setAttribute('points', points.join(' '));
    }
    return target;
  };
  const svg = element('svg');
  svg.setAttribute('viewBox', icon.viewBox.map(n).join(' '));
  svg.setAttribute('data-icon-id', icon.id);
  if (icon.accessibility.kind === 'decorative') svg.setAttribute('aria-hidden', 'true');
  else {
    svg.setAttribute('role', 'img');
    const title = element('title');
    title.textContent = icon.accessibility.label ?? icon.name;
    svg.appendChild(title);
  }
  for (const node of resolveVariantNodes(icon, options.variantId)) {
    const rendered = drawing(node, true);
    if (rendered) svg.appendChild(rendered);
  }
  return svg;
}
