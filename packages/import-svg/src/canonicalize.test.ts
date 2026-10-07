import { describe, expect, it } from 'vitest';
import { parseSvgAst } from './safe-ast.js';
import { canonicalizeSvgAst } from './canonicalize.js';

const iconId = '0198e09b-a810-7000-8000-000000000101';
const provenanceId = '0198e09b-a810-7000-8000-000000000102';
function options() {
  let index = 0;
  return { iconId, provenanceId, name: 'imported',
    nextNodeId: () => `0198e09b-a810-7000-8000-${(++index).toString(16).padStart(12, '0')}` };
}

describe('SVG canonicalization', () => {
  it('converts quantized primitives and inherited paint into editable scene nodes', () => {
    const ast = parseSvgAst('<svg viewBox="0 0 24 24" fill="#123"><g stroke="currentColor" stroke-width="1.5" transform="translate(2 3)"><rect x="1.2345" y="2" width="4" height="6" rx="1"/><circle cx="10" cy="10" r="2"/><line x1="1" y1="1" x2="3" y2="4"/></g></svg>');
    const { icon, diagnostics } = canonicalizeSvgAst(ast, options());
    expect(diagnostics).toEqual([]);
    expect(icon.viewBox).toEqual([0, 0, 24, 24]);
    expect(icon.provenanceIds).toEqual([provenanceId]);
    expect(icon.nodes).toHaveLength(1);
    const group = icon.nodes[0]!;
    expect(group).toMatchObject({ type: 'group', transform: [1, 0, 0, 1, 2, 3] });
    if (group.type !== 'group') throw new Error('Expected group');
    expect(group.children[0]).toMatchObject({ type: 'rect', x: 1.234, rx: 1, ry: 1,
      fill: { kind: 'color', value: '#112233' }, stroke: { paint: { kind: 'token', token: 'currentColor' }, width: 1.5 } });
    expect(group.children[1]).toMatchObject({ type: 'ellipse', rx: 2, ry: 2 });
    expect(group.children[2]).toMatchObject({ type: 'line', x1: 1, y2: 4 });
  });

  it('expands a local use instance with placement and does not render defs', () => {
    const ast = parseSvgAst('<svg viewBox="0 0 24 24"><defs><symbol id="shape"><rect width="4" height="4"/></symbol></defs><use href="#shape" x="2" y="3"/></svg>');
    const { icon } = canonicalizeSvgAst(ast, options());
    expect(icon.nodes).toHaveLength(1);
    expect(icon.nodes[0]).toMatchObject({ type: 'group', transform: [1, 0, 0, 1, 2, 3],
      children: [{ type: 'group', children: [{ type: 'rect', width: 4 }] }] });
  });

  it.each([
    ['missing viewBox', '<svg><rect width="2" height="2"/></svg>', 'import.viewbox-invalid'],
    ['unsupported paint', '<svg viewBox="0 0 24 24"><rect width="2" height="2" fill="red"/></svg>', 'import.paint-unsupported'],
    ['lossy fill opacity', '<svg viewBox="0 0 24 24"><rect width="2" height="2" fill-opacity="0.5"/></svg>', 'import.opacity-unsupported'],
    ['malformed path', '<svg viewBox="0 0 24 24"><path d="M0 0 L1"/></svg>', 'import.path-invalid'],
    ['unmapped attribute', '<svg viewBox="0 0 24 24"><rect width="2" height="2" cx="3"/></svg>', 'import.attribute-unsupported'],
    ['nested viewport', '<svg viewBox="0 0 24 24"><svg viewBox="0 0 8 8"><rect width="2" height="2"/></svg></svg>', 'import.nested-svg-unsupported'],
    ['mismatched viewport', '<svg viewBox="0 0 24 24" width="48" height="24"><rect width="2" height="2"/></svg>', 'import.viewport-aspect-unsupported'],
    ['negative radius', '<svg viewBox="0 0 24 24"><circle r="-1"/></svg>', 'import.geometry-invalid'],
    ['one polyline point', '<svg viewBox="0 0 24 24"><polyline points="1 2"/></svg>', 'import.geometry-invalid'],
  ])('rejects %s explicitly', (_name, source, error) => {
    expect(() => canonicalizeSvgAst(parseSvgAst(source), options())).toThrow(error);
  });

  it('converts relative, smooth and arc path commands to absolute structured segments', () => {
    const ast = parseSvgAst('<svg viewBox="0 0 24 24"><path d="M1 1 l2 0 h1 v2 q1 1 2 0 t2 0 c1 1 2 1 3 0 s2 -1 3 0 a2 2 0 0 1 2 2 z" fill-rule="evenodd"/></svg>');
    const { icon, diagnostics } = canonicalizeSvgAst(ast, options());
    const node = icon.nodes[0]!;
    expect(node.type).toBe('path');
    if (node.type !== 'path') throw new Error('Expected path');
    expect(node.fillRule).toBe('evenodd');
    expect(node.path).toHaveLength(1);
    expect(node.path[0]!.start).toEqual([1, 1]);
    expect(node.path[0]!.closed).toBe(true);
    expect(node.path[0]!.segments.slice(0, 3)).toEqual([
      { k: 'L', to: [3, 1] }, { k: 'L', to: [4, 1] }, { k: 'L', to: [4, 3] },
    ]);
    expect(node.path[0]!.segments.some(segment => segment.k === 'Q')).toBe(true);
    expect(node.path[0]!.segments.filter(segment => segment.k === 'C').length).toBeGreaterThanOrEqual(3);
    expect(diagnostics).toEqual([{ code: 'import.arc-converted', severity: 'info',
      message: 'SVG arcs were converted to cubic segments' }]);
  });

  it('continues drawing after a closed path as a new subpath', () => {
    const { icon } = canonicalizeSvgAst(parseSvgAst('<svg viewBox="0 0 24 24"><path d="M0 0 L2 0 Z L2 2"/></svg>'), options());
    const node = icon.nodes[0]!;
    if (node.type !== 'path') throw new Error('Expected path');
    expect(node.path).toEqual([
      { start: [0, 0], segments: [{ k: 'L', to: [2, 0] }], closed: true },
      { start: [0, 0], segments: [{ k: 'L', to: [2, 2] }], closed: false },
    ]);
  });

  it('clamps oversized rectangle corners as SVG does', () => {
    const { icon } = canonicalizeSvgAst(parseSvgAst('<svg viewBox="0 0 24 24"><rect width="4" height="2" rx="10"/></svg>'), options());
    expect(icon.nodes[0]).toMatchObject({ type: 'rect', rx: 2, ry: 1 });
  });

  it('inherits evenodd fill rule and preserves it for polygons and paths', () => {
    const source = '<svg viewBox="0 0 24 24"><g fill-rule="evenodd"><polygon points="0 0 4 0 4 4 0 4"/><path d="M0 0 L2 0 Z"/></g></svg>';
    const { icon } = canonicalizeSvgAst(parseSvgAst(source), options());
    const group = icon.nodes[0]!;
    if (group.type !== 'group') throw new Error('Expected group');
    expect(group.children).toMatchObject([{ type: 'path', fillRule: 'evenodd' }, { type: 'path', fillRule: 'evenodd' }]);
  });
});
