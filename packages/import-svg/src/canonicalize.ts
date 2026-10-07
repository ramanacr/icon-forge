import { quantize, quantizeMatrix, type IconV1, type MatrixV1, type PaintV1,
  type SceneNodeV1, type StrokeV1, type UUID } from '@iconforge/project-model';
import colorName from 'color-name';
import type { SvgElement } from './xml-reader.js';
import { canonicalizePathData } from './path-data.js';

export interface CanonicalizeOptions {
  iconId: UUID;
  provenanceId: UUID;
  name: string;
  nextNodeId(): UUID;
}

export interface CanonicalSvgImport {
  icon: IconV1;
  diagnostics: { code: string; severity: 'info' | 'warning'; message: string }[];
}

interface Style {
  fill: PaintV1;
  fillOpacity: number;
  fillRule: 'nonzero' | 'evenodd';
  stroke: PaintV1;
  strokeOpacity: number;
  strokeWidth: number;
  cap: StrokeV1['cap'];
  join: StrokeV1['join'];
  miterLimit: number;
  dash?: number[];
}

const COMMON = ['id', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'fill-opacity', 'stroke-opacity', 'opacity', 'transform', 'fill-rule'];
const GEOMETRY: Record<string, string[]> = {
  svg: ['viewBox', 'width', 'height'], g: [], symbol: [], 'use-instance': ['x', 'y'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'], polygon: ['points'], path: ['d'],
};
const NUMBERS = /[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;
const IDENTITY: MatrixV1 = [1, 0, 0, 1, 0, 0];

function num(value: string | undefined, fallback = 0): number {
  return value === undefined ? fallback : quantize(Number(value));
}

function length(value: string | undefined, scale: number, fallback = 0): number {
  if (value === undefined) return fallback;
  if (!value.endsWith('%')) return num(value);
  const resolved = Number(value.slice(0, -1)) * scale / 100;
  if (!Number.isFinite(resolved) || Math.abs(resolved) > 1e6) throw new TypeError('import.coordinate-limit');
  return quantize(resolved);
}

function list(value: string): number[] {
  return [...value.matchAll(NUMBERS)].map(match => num(match[0]));
}

function rawList(value: string): number[] {
  return [...value.matchAll(NUMBERS)].map(match => Number(match[0]));
}

function functionalPaint(value: string): string | undefined {
  const match = /^(rgb|rgba|hsl|hsla)\((.*)\)$/i.exec(value);
  if (!match) return undefined;
  const functionName = match[1]!.toLowerCase();
  const body = match[2]!.trim();
  const comma = body.includes(',');
  if (comma && body.includes('/')) return undefined;
  const parts = comma ? body.split(',').map(part => part.trim())
    : body.replace('/', ' / ').trim().split(/\s+/);
  const alphaIndex = parts.indexOf('/');
  const channels = comma ? parts.slice(0, 3) : alphaIndex < 0 ? parts : parts.slice(0, alphaIndex);
  const alphaText = alphaIndex < 0 ? (comma ? parts[3] : undefined) : parts[alphaIndex + 1];
  if (channels.length !== 3 || (comma && parts.length !== (functionName.endsWith('a') ? 4 : 3))
    || (!comma && (alphaIndex < 0 ? parts.length !== 3 : alphaIndex !== 3 || parts.length !== 5))
    || (functionName.endsWith('a') && alphaText === undefined)) return undefined;
  const numeric = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  const percentage = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)%$/;
  const unit = (text: string, percentOnly = false): number | undefined => {
    if (percentage.test(text)) return Number(text.slice(0, -1)) / 100;
    if (!percentOnly && numeric.test(text)) return Number(text);
    return undefined;
  };
  const alpha = alphaText === undefined ? 1 : unit(alphaText);
  if (alpha === undefined || alpha < 0 || alpha > 1) return undefined;
  let rgb: number[];
  if (functionName.startsWith('rgb')) {
    const percentChannels = channels.every(channel => percentage.test(channel));
    if (!percentChannels && !channels.every(channel => numeric.test(channel))) return undefined;
    rgb = channels.map(channel => Number(percentChannels ? channel.slice(0, -1) : channel));
    if (rgb.some(channel => channel < 0 || channel > (percentChannels ? 100 : 255))) return undefined;
    if (percentChannels) rgb = rgb.map(channel => channel * 255 / 100);
  } else {
    const hueText = channels[0]!.replace(/deg$/i, '');
    if (!numeric.test(hueText)) return undefined;
    const hue = Number(hueText);
    if (!Number.isFinite(hue)) return undefined;
    const saturation = unit(channels[1]!, true);
    const lightness = unit(channels[2]!, true);
    if (saturation === undefined || lightness === undefined || saturation < 0 || saturation > 1
      || lightness < 0 || lightness > 1) return undefined;
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const sector = ((hue % 360) + 360) % 360 / 60;
    const secondary = chroma * (1 - Math.abs(sector % 2 - 1));
    const primaries = sector < 1 ? [chroma, secondary, 0] : sector < 2 ? [secondary, chroma, 0]
      : sector < 3 ? [0, chroma, secondary] : sector < 4 ? [0, secondary, chroma]
        : sector < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
    rgb = primaries.map(channel => (channel + lightness - chroma / 2) * 255);
  }
  const bytes = [...rgb, ...(alphaText === undefined ? [] : [alpha * 255])];
  return `#${bytes.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function paint(value: string): PaintV1 {
  if (value === 'none') return { kind: 'none' };
  if (value === 'currentColor') return { kind: 'token', token: 'currentColor' };
  if (value.toLowerCase() === 'transparent') return { kind: 'color', value: '#00000000' };
  const key = value.toLowerCase();
  const named = Object.hasOwn(colorName, key) ? colorName[key as keyof typeof colorName] : undefined;
  if (named) return { kind: 'color', value: `#${named.map(channel => channel.toString(16).padStart(2, '0')).join('')}` };
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const digits = value.slice(1).toLowerCase();
    return { kind: 'color', value: `#${[...digits].map(digit => digit + digit).join('')}` };
  }
  if (/^#[0-9a-fA-F]{4}$/.test(value)) {
    return { kind: 'color', value: `#${[...value.slice(1).toLowerCase()].map(digit => digit + digit).join('')}` };
  }
  if (/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(value)) {
    return { kind: 'color', value: value.toLowerCase() };
  }
  const functional = functionalPaint(value);
  if (functional) return { kind: 'color', value: functional };
  throw new TypeError('import.paint-unsupported');
}

function styled(parent: Style, attributes: Record<string, string>, diagonal: number): Style {
  const fillOpacity = attributes['fill-opacity'] === undefined ? parent.fillOpacity : Number(attributes['fill-opacity']);
  const strokeOpacity = attributes['stroke-opacity'] === undefined ? parent.strokeOpacity : Number(attributes['stroke-opacity']);
  if (fillOpacity < 0 || fillOpacity > 1 || strokeOpacity < 0 || strokeOpacity > 1) {
    throw new TypeError('import.opacity-unsupported');
  }
  const cap = attributes['stroke-linecap'] ?? parent.cap;
  const join = attributes['stroke-linejoin'] ?? parent.join;
  const fillRule = attributes['fill-rule'] ?? parent.fillRule;
  if (cap !== 'butt' && cap !== 'round' && cap !== 'square') throw new TypeError('import.stroke-unsupported');
  if (join !== 'miter' && join !== 'round' && join !== 'bevel') throw new TypeError('import.stroke-unsupported');
  if (fillRule !== 'nonzero' && fillRule !== 'evenodd') throw new TypeError('import.fill-rule-unsupported');
  const strokeWidth = length(attributes['stroke-width'], diagonal, parent.strokeWidth);
  const miterLimit = num(attributes['stroke-miterlimit'], parent.miterLimit);
  if (strokeWidth < 0 || miterLimit < 1) throw new TypeError('import.stroke-unsupported');
  const dash = attributes['stroke-dasharray'] === undefined ? parent.dash : list(attributes['stroke-dasharray']);
  if (dash?.some(value => value < 0)) throw new TypeError('import.stroke-unsupported');
  return { fill: attributes.fill === undefined ? parent.fill : paint(attributes.fill), fillOpacity, fillRule,
    stroke: attributes.stroke === undefined ? parent.stroke : paint(attributes.stroke),
    strokeOpacity, strokeWidth, cap, join, miterLimit, ...(dash ? { dash } : {}) };
}

function multiply(a: MatrixV1, b: MatrixV1): MatrixV1 {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function transform(value: string | undefined): MatrixV1 | undefined {
  if (value === undefined) return undefined;
  let result: MatrixV1 = IDENTITY;
  const operation = /([A-Za-z]+)\s*\(([^()]*)\)/g;
  for (const match of value.matchAll(operation)) {
    const args = rawList(match[2]!);
    let next: MatrixV1;
    switch (match[1]) {
      case 'matrix': next = args as MatrixV1; break;
      case 'translate': next = [1, 0, 0, 1, args[0]!, args[1] ?? 0]; break;
      case 'scale': next = [args[0]!, 0, 0, args[1] ?? args[0]!, 0, 0]; break;
      case 'rotate': {
        const radians = args[0]! * Math.PI / 180;
        const rotation: MatrixV1 = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];
        const center: MatrixV1 = [1, 0, 0, 1, args[1] ?? 0, args[2] ?? 0];
        next = multiply(multiply(center, rotation), [1, 0, 0, 1, -center[4], -center[5]]);
        break;
      }
      case 'skewX': next = [1, 0, Math.tan(args[0]! * Math.PI / 180), 1, 0, 0]; break;
      case 'skewY': next = [1, Math.tan(args[0]! * Math.PI / 180), 0, 1, 0, 0]; break;
      default: throw new TypeError('import.transform-invalid');
    }
    result = multiply(result, next);
  }
  if (result.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) {
    throw new TypeError('import.transform-invalid');
  }
  return quantizeMatrix(result);
}

function withOpacity(value: PaintV1, opacity: number): PaintV1 {
  if (opacity === 1 || value.kind === 'none') return value;
  if (value.kind !== 'color') throw new TypeError('import.opacity-unsupported');
  const originalAlpha = value.value.length === 9 ? Number.parseInt(value.value.slice(7), 16) : 255;
  const alpha = Math.round(originalAlpha * opacity).toString(16).padStart(2, '0');
  return { kind: 'color', value: `${value.value.slice(0, 7)}${alpha}` };
}

function stroke(style: Style): StrokeV1 {
  return { paint: withOpacity(style.stroke, style.strokeOpacity), width: style.strokeWidth, cap: style.cap, join: style.join,
    miterLimit: style.miterLimit, ...(style.dash ? { dash: style.dash } : {}) };
}

/** Convert an already validated, expanded SVG AST without importing markup into the DOM. */
export function canonicalizeSvgAst(ast: SvgElement, options: CanonicalizeOptions): CanonicalSvgImport {
  if (ast.name !== 'svg') throw new TypeError('import.invalid-root');
  const rootWidth = ast.attributes.width === undefined ? undefined : Number(ast.attributes.width.replace(/px$/, ''));
  const rootHeight = ast.attributes.height === undefined ? undefined : Number(ast.attributes.height.replace(/px$/, ''));
  const viewBox = ast.attributes.viewBox === undefined
    ? rootWidth !== undefined && rootHeight !== undefined ? [0, 0, num(String(rootWidth)), num(String(rootHeight))] : []
    : list(ast.attributes.viewBox);
  if (viewBox.length !== 4 || viewBox[2]! <= 0 || viewBox[3]! <= 0) throw new TypeError('import.viewbox-invalid');
  const viewportWidth = viewBox[2]!;
  const viewportHeight = viewBox[3]!;
  const viewportDiagonal = Math.hypot(viewportWidth, viewportHeight) / Math.SQRT2;
  const initial: Style = { fill: { kind: 'color', value: '#000000' }, fillOpacity: 1,
    stroke: { kind: 'none' }, strokeOpacity: 1,
    fillRule: 'nonzero', strokeWidth: 1, cap: 'butt', join: 'miter', miterLimit: 4 };
  let arcConverted = false;
  const convert = (element: SvgElement, inherited: Style): SceneNodeV1 | null => {
    if (element.name === 'defs') return null;
    if (element.name === 'svg') throw new TypeError('import.nested-svg-unsupported');
    const allowed = GEOMETRY[element.name];
    if (!allowed) throw new TypeError('import.element-unsupported');
    for (const attribute of Object.keys(element.attributes)) {
      if (!COMMON.includes(attribute) && !allowed.includes(attribute)) throw new TypeError('import.attribute-unsupported');
    }
    const style = styled(inherited, element.attributes, viewportDiagonal);
    const matrix = transform(element.attributes.transform);
    const base = { id: options.nextNodeId(), visible: true, locked: false,
      ...(element.attributes.id ? { name: element.attributes.id } : {}),
      ...(element.attributes.opacity === undefined ? {} : { opacity: num(element.attributes.opacity) }),
      ...(matrix ? { transform: matrix } : {}) };
    if (base.opacity !== undefined && (base.opacity < 0 || base.opacity > 1)) throw new TypeError('import.opacity-unsupported');
    if (element.name === 'g' || element.name === 'symbol' || element.name === 'use-instance') {
      if (element.name === 'symbol' && element.attributes.viewBox !== undefined) throw new TypeError('import.symbol-viewbox-unsupported');
      const children = element.children.map(child => convert(child, style)).filter((node): node is SceneNodeV1 => node !== null);
      if (element.name === 'use-instance') {
        const placement: MatrixV1 = [1, 0, 0, 1,
          length(element.attributes.x, viewportWidth), length(element.attributes.y, viewportHeight)];
        base.transform = quantizeMatrix(multiply(base.transform ?? IDENTITY, placement));
      }
      return { ...base, type: 'group', children };
    }
    if (element.children.length) throw new TypeError('import.element-children');
    const fills = { fill: withOpacity(style.fill, style.fillOpacity),
      ...(style.stroke.kind === 'none' ? {} : { stroke: stroke(style) }) };
    if (element.name === 'rect') {
      const a = element.attributes;
      const rx = length(a.rx, viewportWidth, length(a.ry, viewportHeight));
      const ry = length(a.ry, viewportHeight, rx);
      const width = length(a.width, viewportWidth);
      const height = length(a.height, viewportHeight);
      if (width < 0 || height < 0 || rx < 0 || ry < 0) {
        throw new TypeError('import.geometry-invalid');
      }
      const clampedRx = rx > width / 2 ? Math.floor(width * 500) / 1000 : rx;
      const clampedRy = ry > height / 2 ? Math.floor(height * 500) / 1000 : ry;
      return { ...base, type: 'rect', x: length(a.x, viewportWidth), y: length(a.y, viewportHeight), width, height,
        rx: clampedRx, ry: clampedRy, ...fills };
    }
    if (element.name === 'circle' || element.name === 'ellipse') {
      const a = element.attributes;
      const rx = element.name === 'circle' ? length(a.r, viewportDiagonal) : length(a.rx, viewportWidth);
      const ry = element.name === 'circle' ? rx : length(a.ry, viewportHeight);
      if (rx < 0 || ry < 0) throw new TypeError('import.geometry-invalid');
      return { ...base, type: 'ellipse', cx: length(a.cx, viewportWidth), cy: length(a.cy, viewportHeight),
        rx, ry, ...fills };
    }
    if (element.name === 'line') {
      const a = element.attributes;
      return { ...base, type: 'line', x1: length(a.x1, viewportWidth), y1: length(a.y1, viewportHeight),
        x2: length(a.x2, viewportWidth), y2: length(a.y2, viewportHeight), stroke: stroke(style) };
    }
    if (element.name === 'polyline' || element.name === 'polygon') {
      const points = list(element.attributes.points ?? '');
      if (points.length < 4 || points.length % 2) throw new TypeError('import.geometry-invalid');
      if (style.fillRule === 'evenodd') {
        const start: [number, number] = [points[0]!, points[1]!];
        const segments = [];
        for (let index = 2; index < points.length; index += 2) {
          segments.push({ k: 'L' as const, to: [points[index]!, points[index + 1]!] as [number, number] });
        }
        return { ...base, type: 'path', path: [{ start, segments, closed: element.name === 'polygon' }],
          fillRule: 'evenodd', ...fills };
      }
      return { ...base, type: 'polyline', points,
        closed: element.name === 'polygon', ...fills };
    }
    const converted = canonicalizePathData(element.attributes.d ?? '');
    arcConverted ||= converted.arcConverted;
    return { ...base, type: 'path', path: converted.path, fillRule: style.fillRule, ...fills };
  };
  for (const attribute of Object.keys(ast.attributes)) {
    if (!COMMON.includes(attribute) && !GEOMETRY.svg!.includes(attribute)) throw new TypeError('import.attribute-unsupported');
  }
  if (ast.attributes.transform !== undefined || ast.attributes.opacity !== undefined) {
    throw new TypeError('import.root-transform-unsupported');
  }
  if ((rootWidth === undefined) !== (rootHeight === undefined)
    || rootWidth !== undefined && rootHeight !== undefined
      && (rootWidth <= 0 || rootHeight <= 0
        || Math.abs(rootWidth * viewBox[3]! - rootHeight * viewBox[2]!) > 1e-6)) {
    throw new TypeError('import.viewport-aspect-unsupported');
  }
  const rootStyle = styled(initial, ast.attributes, viewportDiagonal);
  const nodes = ast.children.map(child => convert(child, rootStyle)).filter((node): node is SceneNodeV1 => node !== null);
  return { icon: { id: options.iconId, name: options.name, aliases: [], tags: [],
    viewBox: viewBox as IconV1['viewBox'], nodes, variants: [],
    accessibility: { kind: 'decorative' }, provenanceIds: [options.provenanceId] },
  diagnostics: arcConverted ? [{ code: 'import.arc-converted', severity: 'info',
    message: 'SVG arcs were converted to cubic segments' }] : [] };
}
