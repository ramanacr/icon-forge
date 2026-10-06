import { describe, expect, it } from 'vitest';
import { readSvgXml } from './xml-reader.js';

describe('bounded SVG XML reader', () => {
  it('reads one SVG root and its child attributes as data', () => {
    expect(readSvgXml('<?xml version="1.0"?><svg viewBox="0 0 24 24"><rect x="2" width="5"/></svg>'))
      .toEqual({ name: 'svg', attributes: { viewBox: '0 0 24 24' }, children: [
        { name: 'rect', attributes: { x: '2', width: '5' }, children: [] },
      ] });
  });

  it.each([
    ['DOCTYPE', '<!DOCTYPE svg [<!ENTITY x "boom">]><svg/>'],
    ['processing instruction', '<?probe execute?><svg/>'],
    ['malformed XML', '<svg><rect></svg>'],
    ['multiple roots', '<svg/><svg/>'],
  ])('rejects %s', (_name, source) => {
    expect(() => readSvgXml(source)).toThrow();
  });

  it('counts UTF-8 bytes, not JavaScript code units', () => {
    const source = `<svg><!--${'é'.repeat(1_048_570)}--></svg>`;
    expect(source.length).toBeLessThan(2 * 1024 * 1024);
    expect(() => readSvgXml(source)).toThrow('import.source-limit');
  });

  it('rejects excessive depth, element count and path data', () => {
    expect(() => readSvgXml(`<svg>${'<g>'.repeat(32)}${'</g>'.repeat(32)}</svg>`)).toThrow('import.depth-limit');
    expect(() => readSvgXml(`<svg>${'<g/>'.repeat(5_000)}</svg>`)).toThrow('import.element-limit');
    expect(() => readSvgXml(`<svg><path d="${'0'.repeat(200_001)}"/></svg>`)).toThrow('import.path-limit');
  });

  it('permits tighter limits but rejects limits above the security defaults', () => {
    expect(() => readSvgXml('<svg><rect/></svg>', { elements: 1 })).toThrow('import.element-limit');
    expect(() => readSvgXml('<svg/>', { elements: 5_001 })).toThrow('import.limit-invalid');
    expect(() => readSvgXml('<svg/>', { toString: 1 } as never)).toThrow('import.limit-invalid');
  });
});
