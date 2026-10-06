import { SaxesParser } from 'saxes';

export interface SvgElement {
  name: string;
  attributes: Record<string, string>;
  children: SvgElement[];
}

export interface ImportLimits {
  sourceBytes: number;
  elements: number;
  pathDataChars: number;
  nesting: number;
  coordinates: number;
  useDepth: number;
  expandedNodes: number;
}

const DEFAULT_LIMITS: ImportLimits = {
  sourceBytes: 2 * 1024 * 1024, elements: 5_000, pathDataChars: 200_000,
  nesting: 32, coordinates: 1e6, useDepth: 8, expandedNodes: 2_000,
};

export function resolveImportLimits(requested: Partial<ImportLimits> = {}): ImportLimits {
  const resolved = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(requested) as Array<keyof ImportLimits>) {
    const value = requested[key];
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value! <= 0 || value! > DEFAULT_LIMITS[key]) {
      throw new TypeError('import.limit-invalid');
    }
    resolved[key] = value!;
  }
  return resolved;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

export function readSvgXml(source: string, requestedLimits: Partial<ImportLimits> = {}): SvgElement {
  const limits = resolveImportLimits(requestedLimits);
  if (new TextEncoder().encode(source).byteLength > limits.sourceBytes) throw new TypeError('import.source-limit');
  const parser = new SaxesParser({ xmlns: true });
  let root: SvgElement | null = null;
  const stack: SvgElement[] = [];
  let count = 0;
  parser.on('doctype', () => { throw new TypeError('import.doctype'); });
  parser.on('processinginstruction', () => { throw new TypeError('import.processing-instruction'); });
  parser.on('cdata', () => { throw new TypeError('import.cdata'); });
  parser.on('text', value => { if (value.trim()) throw new TypeError('import.text-unsupported'); });
  parser.on('error', () => { throw new TypeError('import.xml-invalid'); });
  parser.on('opentag', tag => {
    if (++count > limits.elements) throw new TypeError('import.element-limit');
    if (stack.length >= limits.nesting) throw new TypeError('import.depth-limit');
    if (tag.uri !== '' && tag.uri !== SVG_NS) throw new TypeError('import.namespace');
    const attributes: Record<string, string> = {};
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.uri === XMLNS_NS) continue;
      if (attribute.uri !== '' && attribute.uri !== XLINK_NS && attribute.uri !== XML_NS) {
        throw new TypeError('import.namespace');
      }
      if (attribute.name === 'd' && attribute.value.length > limits.pathDataChars) throw new TypeError('import.path-limit');
      attributes[attribute.name] = attribute.value;
    }
    const node: SvgElement = { name: tag.local, attributes, children: [] };
    if (stack.length) stack.at(-1)!.children.push(node);
    else if (!root) root = node;
    else throw new TypeError('import.multiple-roots');
    stack.push(node);
  });
  parser.on('closetag', () => { stack.pop(); });
  parser.write(source).close();
  const document = root as SvgElement | null;
  if (!document || document.name !== 'svg') throw new TypeError('import.invalid-root');
  return document;
}
