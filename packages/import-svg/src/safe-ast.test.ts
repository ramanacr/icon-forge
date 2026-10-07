import { describe, expect, it } from 'vitest';
import { parseSvgAst } from './safe-ast.js';

describe('safe SVG import AST', () => {
  it('retains safe primitive data without DOM nodes', () => {
    expect(parseSvgAst('<svg viewBox="0 0 24 24"><g transform="translate(1 2)"><path d="M0 0 L2 2" fill="currentColor"/></g></svg>'))
      .toEqual({ name: 'svg', attributes: { viewBox: '0 0 24 24' }, children: [{
        name: 'g', attributes: { transform: 'translate(1 2)' }, children: [
          { name: 'path', attributes: { d: 'M0 0 L2 2', fill: 'currentColor' }, children: [] },
        ],
      }] });
  });

  it('normalizes strictly allowlisted inline styles over presentation attributes', () => {
    const ast = parseSvgAst('<svg><rect width="4" fill="black" style="fill: red; stroke-width: 2; stroke: currentColor"/></svg>');
    expect(ast.children[0]?.attributes).toMatchObject({ fill: 'red', stroke: 'currentColor', 'stroke-width': '2' });
    expect(ast.children[0]?.attributes.style).toBeUndefined();
  });

  it.each([
    'fill:url(https://example.com/a.svg)',
    'fill:var(--paint)',
    'clip-path: none',
    'fill: red; fill: blue',
    'fill: r\\ed',
  ])('rejects unsafe or ambiguous inline style %s', style => {
    expect(() => parseSvgAst(`<svg><rect style="${style}"/></svg>`)).toThrow('import.style-unsupported');
  });

  it('expands local use targets as bounded data instances', () => {
    const source = '<svg><defs><symbol id="shape"><rect width="4" height="4"/></symbol></defs><use href="#shape" x="2"/></svg>';
    const result = parseSvgAst(source);
    expect(result.children[1]).toEqual({ name: 'use-instance', attributes: { x: '2' }, children: [
      { name: 'symbol', attributes: { id: 'shape' }, children: [
        { name: 'rect', attributes: { width: '4', height: '4' }, children: [] },
      ] },
    ] });
  });

  it.each([
    ['script', '<svg><script/></svg>'],
    ['event handler', '<svg onload="alert(1)"/>'],
    ['prototype-like attribute', '<svg __proto__="ignored"/>'],
    ['foreign object', '<svg><foreignObject/></svg>'],
    ['image', '<svg><image href="x"/></svg>'],
    ['data URL', '<svg><use href="data:text/html,x"/></svg>'],
    ['external URL', '<svg><use xlink:href="https://example.com/a.svg#x" xmlns:xlink="http://www.w3.org/1999/xlink"/></svg>'],
    ['javascript URL', '<svg><path fill="javascript:alert(1)"/></svg>'],
    ['style', '<svg style="fill:url(https://example.com/a)"/>'],
    ['mask', '<svg><mask/></svg>'],
    ['filter', '<svg><filter/></svg>'],
    ['animation', '<svg><animate/></svg>'],
    ['clip path until conversion is available', '<svg><clipPath id="c"><rect width="1"/></clipPath></svg>'],
  ])('rejects %s', (_name, source) => expect(() => parseSvgAst(source)).toThrow());

  it('rejects use cycles and expansion limits', () => {
    expect(() => parseSvgAst('<svg><defs><g id="a"><use href="#a"/></g></defs><use href="#a"/></svg>'))
      .toThrow('import.use-cycle');
    let nested = '<g id="n9"><rect width="1"/></g>';
    for (let index = 8; index >= 0; index--) nested += `<g id="n${index}"><use href="#n${index + 1}"/></g>`;
    expect(() => parseSvgAst(`<svg><defs>${nested}</defs><use href="#n0"/></svg>`)).toThrow('import.use-depth');
    const repeated = `<svg><defs><g id="a">${'<rect width="1"/>'.repeat(101)}</g></defs>${'<use href="#a"/>'.repeat(20)}</svg>`;
    expect(() => parseSvgAst(repeated)).toThrow('import.use-limit');
  });

  it('applies tighter use and coordinate limits', () => {
    const source = '<svg><defs><rect id="a" width="4"/></defs><use href="#a"/></svg>';
    expect(() => parseSvgAst(source, { expandedNodes: 1 })).toThrow('import.use-limit');
    expect(() => parseSvgAst('<svg><rect x="5"/></svg>', { coordinates: 4 })).toThrow('import.coordinate-limit');
    expect(() => parseSvgAst('<svg/>', { useDepth: 9 })).toThrow('import.limit-invalid');
  });

  it.each([
    '<svg viewBox="0 0 1000001 24"/>',
    '<svg><rect x="NaN"/></svg>',
    '<svg><rect width="1e999"/></svg>',
    '<svg><path d="M0 nope"/></svg>',
    '<svg><path d="M0,,0"/></svg>',
    '<svg><polyline points="1,2,3"/></svg>',
    '<svg viewBox="0,,0 24 24"/>',
    '<svg><g transform="translate(2)garbage"/></svg>',
    '<svg><g transform="matrix(1 0 0)"/></svg>',
    '<svg><g transform="translate(1e999)"/></svg>',
  ])('rejects malformed or extreme geometry in %s', source => {
    expect(() => parseSvgAst(source)).toThrow();
  });
});
