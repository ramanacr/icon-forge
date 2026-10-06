import { SaxesParser } from 'saxes';

export interface SvgElement {
  name: string;
  attributes: Record<string, string>;
  children: SvgElement[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

export function readSvgXml(source: string): SvgElement {
  if (new TextEncoder().encode(source).byteLength > 2 * 1024 * 1024) throw new TypeError('import.source-limit');
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
    if (++count > 5_000) throw new TypeError('import.element-limit');
    if (stack.length >= 32) throw new TypeError('import.depth-limit');
    if (tag.uri !== '' && tag.uri !== SVG_NS) throw new TypeError('import.namespace');
    const attributes: Record<string, string> = {};
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.uri === XMLNS_NS) continue;
      if (attribute.uri !== '' && attribute.uri !== XLINK_NS && attribute.uri !== XML_NS) {
        throw new TypeError('import.namespace');
      }
      if (attribute.name === 'd' && attribute.value.length > 200_000) throw new TypeError('import.path-limit');
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
