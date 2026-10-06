import { readSvgXml, type SvgElement } from './xml-reader.js';

const elements = new Set(['svg', 'g', 'defs', 'symbol', 'use', 'rect', 'circle', 'ellipse',
  'line', 'polyline', 'polygon', 'path']);
const attributes = new Set(['id', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'points', 'd', 'transform', 'fill', 'fill-rule', 'fill-opacity',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-opacity', 'stroke-dasharray', 'opacity', 'href', 'xlink:href']);
const singleNumbers = new Set(['width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy',
  'r', 'rx', 'ry', 'stroke-width', 'stroke-miterlimit', 'fill-opacity', 'stroke-opacity', 'opacity']);
const numberPattern = /[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;
const commandPattern = /^[MLHVCSQTAZmlhvcsqtaz,\s]*$/;

function checkNumbers(value: string, kind: 'single' | 'list' | 'path'): void {
  const numbers = [...value.matchAll(numberPattern)];
  const remaining = value.replace(numberPattern, '');
  if ((kind === 'single' && (numbers.length !== 1 || remaining.trim()))
    || (kind === 'list' && (!numbers.length || !/^[,\s]*$/.test(remaining)))
    || (kind === 'path' && (!numbers.length || !commandPattern.test(remaining)))) {
    throw new TypeError('import.number-invalid');
  }
  for (const match of numbers) {
    const number = Number(match[0]);
    if (!Number.isFinite(number) || Math.abs(number) > 1e6) throw new TypeError('import.coordinate-limit');
  }
}

function checkTransform(value: string): void {
  const counts: Record<string, readonly number[]> = {
    matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1],
  };
  const operation = /([A-Za-z]+)\s*\(([^()]*)\)/g;
  let end = 0;
  let found = false;
  for (const match of value.matchAll(operation)) {
    if (!/^[,\s]*$/.test(value.slice(end, match.index))) throw new TypeError('import.transform-invalid');
    const args = match[2]!;
    checkNumbers(args, 'list');
    if (!counts[match[1]!]?.includes([...args.matchAll(numberPattern)].length)) {
      throw new TypeError('import.transform-invalid');
    }
    end = match.index! + match[0].length;
    found = true;
  }
  if (!found || !/^[,\s]*$/.test(value.slice(end))) throw new TypeError('import.transform-invalid');
}

function validate(node: SvgElement, ids: Map<string, SvgElement>): void {
  if (!elements.has(node.name)) throw new TypeError('import.element-unsupported');
  for (const [name, value] of Object.entries(node.attributes)) {
    if (name.toLowerCase().startsWith('on') || !attributes.has(name)) throw new TypeError('import.attribute-unsupported');
    if (/url\s*\(|javascript\s*:|data\s*:|@import/i.test(value)) throw new TypeError('import.url-unsupported');
    if (name === 'href' || name === 'xlink:href') {
      if (node.name !== 'use' || !/^#[^\s#]+$/.test(value)) throw new TypeError('import.reference-invalid');
    }
    if (singleNumbers.has(name)) checkNumbers(value, 'single');
    if (name === 'viewBox' || name === 'points' || name === 'stroke-dasharray') {
      checkNumbers(value, 'list');
      if (name === 'viewBox' && [...value.matchAll(numberPattern)].length !== 4) throw new TypeError('import.number-invalid');
      if (name === 'points' && [...value.matchAll(numberPattern)].length % 2) throw new TypeError('import.number-invalid');
    }
    if (name === 'd') checkNumbers(value, 'path');
    if (name === 'transform') checkTransform(value);
  }
  const id = node.attributes.id;
  if (id !== undefined) {
    if (!id || /\s/.test(id) || ids.has(id)) throw new TypeError('import.id-invalid');
    ids.set(id, node);
  }
  if (node.name === 'use') {
    const href = node.attributes.href ?? node.attributes['xlink:href'];
    if (!href || (node.attributes.href && node.attributes['xlink:href']
      && node.attributes.href !== node.attributes['xlink:href'])) throw new TypeError('import.reference-invalid');
    if (node.children.length) throw new TypeError('import.use-children');
  }
  for (const child of node.children) validate(child, ids);
}

/** Data-only import AST. `use-instance` retains placement attributes for later canonical conversion. */
export function parseSvgAst(source: string): SvgElement {
  const root = readSvgXml(source);
  const ids = new Map<string, SvgElement>();
  validate(root, ids);
  let expandedCount = 0;
  const expand = (node: SvgElement, chain: readonly string[], depth: number): SvgElement => {
    if (node.name === 'use') {
      const href = node.attributes.href ?? node.attributes['xlink:href']!;
      const id = href.slice(1);
      if (chain.includes(id)) throw new TypeError('import.use-cycle');
      if (depth >= 8) throw new TypeError('import.use-depth');
      const target = ids.get(id);
      if (!target) throw new TypeError('import.use-missing');
      const { href: _href, 'xlink:href': _xlinkHref, ...placement } = node.attributes;
      if (++expandedCount > 2_000) throw new TypeError('import.use-limit');
      return { name: 'use-instance', attributes: placement,
        children: [expand(target, [...chain, id], depth + 1)] };
    }
    if (chain.length && ++expandedCount > 2_000) throw new TypeError('import.use-limit');
    return { name: node.name, attributes: { ...node.attributes },
      children: node.name === 'defs' && chain.length === 0
        ? structuredClone(node.children) : node.children.map(child => expand(child, chain, depth)) };
  };
  return expand(root, [], 0);
}
