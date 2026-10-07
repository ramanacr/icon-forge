import { readSvgXml, resolveImportLimits, type ImportLimits, type SvgElement } from './xml-reader.js';

const elements = new Set(['svg', 'g', 'defs', 'symbol', 'use', 'rect', 'circle', 'ellipse',
  'line', 'polyline', 'polygon', 'path']);
const attributes = new Set(['id', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'points', 'd', 'transform', 'fill', 'fill-rule', 'fill-opacity',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-opacity', 'stroke-dasharray', 'opacity', 'href', 'xlink:href']);
const singleNumbers = new Set(['width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy',
  'r', 'rx', 'ry', 'stroke-width', 'stroke-miterlimit', 'fill-opacity', 'stroke-opacity', 'opacity']);
const percentageLengths = new Set(['width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'stroke-width']);
const numberPattern = /[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;
const commandPattern = /^[MLHVCSQTAZmlhvcsqtaz,\s]*$/;
const styleProperties = new Set(['fill', 'stroke', 'fill-rule', 'fill-opacity', 'stroke-opacity',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'opacity']);

function inlineStyle(value: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  if (/[\\{}]|\/\*|\*\/|url\s*\(|var\s*\(|@import|javascript\s*:|data\s*:/i.test(value)) {
    throw new TypeError('import.style-unsupported');
  }
  for (const declaration of value.split(';')) {
    if (!declaration.trim()) continue;
    const separator = declaration.indexOf(':');
    if (separator < 0) throw new TypeError('import.style-unsupported');
    const name = declaration.slice(0, separator).trim();
    const setting = declaration.slice(separator + 1).trim();
    if (!styleProperties.has(name) || !setting || Object.hasOwn(declarations, name)) {
      throw new TypeError('import.style-unsupported');
    }
    declarations[name] = setting;
  }
  return declarations;
}

function checkNumbers(value: string, kind: 'single' | 'list' | 'path', maxCoordinate: number): void {
  if (kind === 'path') {
    if (/,\s*,/.test(value) || /,\s*$/.test(value)) throw new TypeError('import.number-invalid');
    numberPattern.lastIndex = 0;
    let end = 0;
    let found = false;
    for (let match = numberPattern.exec(value); match !== null; match = numberPattern.exec(value)) {
      const gap = value.slice(end, match.index);
      if (!commandPattern.test(gap)) throw new TypeError('import.number-invalid');
      const number = Number(match[0]);
      if (!Number.isFinite(number) || Math.abs(number) > maxCoordinate) throw new TypeError('import.coordinate-limit');
      end = numberPattern.lastIndex;
      found = true;
    }
    const tail = value.slice(end);
    if (!found || !commandPattern.test(tail)) throw new TypeError('import.number-invalid');
    return;
  }
  const numbers = [...value.matchAll(numberPattern)];
  const remaining = value.replace(numberPattern, '');
  if ((kind === 'single' && (numbers.length !== 1 || remaining.trim()))
    || (kind === 'list' && (!numbers.length || !/^[,\s]*$/.test(remaining)))) {
    throw new TypeError('import.number-invalid');
  }
  if (kind === 'list') {
    let end = 0;
    for (const [index, match] of numbers.entries()) {
      const gap = value.slice(end, match.index);
      if (index === 0 ? !/^\s*$/.test(gap)
        : gap === '' ? !/^[+-]/.test(match[0]) : !/^(?:\s+|\s*,\s*)$/.test(gap)) {
        throw new TypeError('import.number-invalid');
      }
      end = match.index! + match[0].length;
    }
    if (!/^\s*$/.test(value.slice(end))) throw new TypeError('import.number-invalid');
  }
  for (const match of numbers) {
    const number = Number(match[0]);
    if (!Number.isFinite(number) || Math.abs(number) > maxCoordinate) throw new TypeError('import.coordinate-limit');
  }
}

function checkTransform(value: string, maxCoordinate: number): void {
  const counts: Record<string, readonly number[]> = {
    matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1],
  };
  const operation = /([A-Za-z]+)\s*\(([^()]*)\)/g;
  let end = 0;
  let found = false;
  for (const match of value.matchAll(operation)) {
    if (!/^[,\s]*$/.test(value.slice(end, match.index))) throw new TypeError('import.transform-invalid');
    const args = match[2]!;
    checkNumbers(args, 'list', maxCoordinate);
    if (!counts[match[1]!]?.includes([...args.matchAll(numberPattern)].length)) {
      throw new TypeError('import.transform-invalid');
    }
    end = match.index! + match[0].length;
    found = true;
  }
  if (!found || !/^[,\s]*$/.test(value.slice(end))) throw new TypeError('import.transform-invalid');
}

function validate(node: SvgElement, ids: Map<string, SvgElement>, limits: ImportLimits): void {
  if (!elements.has(node.name)) throw new TypeError('import.element-unsupported');
  if (node.attributes.style !== undefined) {
    const { style, ...presentation } = node.attributes;
    node.attributes = { ...presentation, ...inlineStyle(style) };
  }
  for (const [name, value] of Object.entries(node.attributes)) {
    if (name.toLowerCase().startsWith('on') || !attributes.has(name)) throw new TypeError('import.attribute-unsupported');
    if (/url\s*\(|javascript\s*:|data\s*:|@import/i.test(value)) throw new TypeError('import.url-unsupported');
    if (name === 'href' || name === 'xlink:href') {
      if (node.name !== 'use' || !/^#[^\s#]+$/.test(value)) throw new TypeError('import.reference-invalid');
    }
    if (singleNumbers.has(name)) {
      if (value.endsWith('%') && percentageLengths.has(name)
        && !(node.name === 'svg' && (name === 'width' || name === 'height'))) {
        checkNumbers(value.slice(0, -1), 'single', limits.coordinates);
      } else if (node.name === 'svg' && (name === 'width' || name === 'height') && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?px$/.test(value)) {
        checkNumbers(value.slice(0, -2), 'single', limits.coordinates);
      } else checkNumbers(value, 'single', limits.coordinates);
    }
    if (name === 'viewBox' || name === 'points' || name === 'stroke-dasharray') {
      checkNumbers(value, 'list', limits.coordinates);
      if (name === 'viewBox' && [...value.matchAll(numberPattern)].length !== 4) throw new TypeError('import.number-invalid');
      if (name === 'points' && [...value.matchAll(numberPattern)].length % 2) throw new TypeError('import.number-invalid');
    }
    if (name === 'd') checkNumbers(value, 'path', limits.coordinates);
    if (name === 'transform') checkTransform(value, limits.coordinates);
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
  for (const child of node.children) validate(child, ids, limits);
}

/** Data-only import AST. `use-instance` retains placement attributes for later canonical conversion. */
export function parseSvgAst(source: string, requestedLimits: Partial<ImportLimits> = {}): SvgElement {
  const limits = resolveImportLimits(requestedLimits);
  const root = readSvgXml(source, limits);
  const ids = new Map<string, SvgElement>();
  validate(root, ids, limits);
  let expandedCount = 0;
  const expand = (node: SvgElement, chain: readonly string[], depth: number): SvgElement => {
    if (node.name === 'use') {
      const href = node.attributes.href ?? node.attributes['xlink:href']!;
      const id = href.slice(1);
      if (chain.includes(id)) throw new TypeError('import.use-cycle');
      if (depth >= limits.useDepth) throw new TypeError('import.use-depth');
      const target = ids.get(id);
      if (!target) throw new TypeError('import.use-missing');
      const { href: _href, 'xlink:href': _xlinkHref, ...placement } = node.attributes;
      if (++expandedCount > limits.expandedNodes) throw new TypeError('import.use-limit');
      return { name: 'use-instance', attributes: placement,
        children: [expand(target, [...chain, id], depth + 1)] };
    }
    if (chain.length && ++expandedCount > limits.expandedNodes) throw new TypeError('import.use-limit');
    return { name: node.name, attributes: { ...node.attributes },
      children: node.name === 'defs' && chain.length === 0
        ? structuredClone(node.children) : node.children.map(child => expand(child, chain, depth)) };
  };
  return expand(root, [], 0);
}
