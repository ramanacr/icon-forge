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
    ['unsupported paint', '<svg viewBox="0 0 24 24"><rect width="2" height="2" fill="color(display-p3 1 0 0)"/></svg>', 'import.paint-unsupported'],
    ['out-of-range color', '<svg viewBox="0 0 24 24"><rect width="2" height="2" fill="rgb(120% 0% 0%)"/></svg>', 'import.paint-unsupported'],
    ['invalid HSL saturation', '<svg viewBox="0 0 24 24"><rect width="2" height="2" fill="hsl(60 150% 50%)"/></svg>', 'import.paint-unsupported'],
    ['prototype-like paint', '<svg viewBox="0 0 24 24"><rect width="2" height="2" fill="constructor"/></svg>', 'import.paint-unsupported'],
    ['unresolved token opacity', '<svg viewBox="0 0 24 24"><rect width="2" height="2" fill="currentColor" fill-opacity="0.5"/></svg>', 'import.opacity-unsupported'],
    ['invalid fill opacity', '<svg viewBox="0 0 24 24"><rect width="2" height="2" fill-opacity="1.5"/></svg>', 'import.opacity-unsupported'],
    ['malformed path', '<svg viewBox="0 0 24 24"><path d="M0 0 L1"/></svg>', 'import.path-invalid'],
    ['unmapped attribute', '<svg viewBox="0 0 24 24"><rect width="2" height="2" cx="3"/></svg>', 'import.attribute-unsupported'],
    ['nested viewport', '<svg viewBox="0 0 24 24"><svg viewBox="0 0 8 8"><rect width="2" height="2"/></svg></svg>', 'import.nested-svg-unsupported'],
    ['mismatched viewport', '<svg viewBox="0 0 24 24" width="48" height="24"><rect width="2" height="2"/></svg>', 'import.viewport-aspect-unsupported'],
    ['negative radius', '<svg viewBox="0 0 24 24"><circle r="-1"/></svg>', 'import.geometry-invalid'],
    ['one polyline point', '<svg viewBox="0 0 24 24"><polyline points="1 2"/></svg>', 'import.geometry-invalid'],
    ['expanded percentage outside coordinate limit', '<svg viewBox="0 0 1000000 1000000"><rect x="200%" width="2" height="2"/></svg>', 'import.coordinate-limit'],
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

  it('uses explicit root dimensions when viewBox is absent and accepts px viewport sizes', () => {
    const ast = parseSvgAst('<svg width="24px" height="16px"><rect width="4" height="4"/></svg>');
    expect(canonicalizeSvgAst(ast, options()).icon.viewBox).toEqual([0, 0, 24, 16]);
  });

  it('normalizes CSS named, short-alpha and rgb paints to model hex values', () => {
    const source = '<svg viewBox="0 0 24 24"><rect width="2" height="2" fill="red"/>'
      + '<rect width="2" height="2" fill="#0f08"/>'
      + '<rect width="2" height="2" fill="rgb(16, 32, 48)"/></svg>';
    const { icon } = canonicalizeSvgAst(parseSvgAst(source), options());
    expect(icon.nodes).toMatchObject([
      { fill: { kind: 'color', value: '#ff0000' } },
      { fill: { kind: 'color', value: '#00ff0088' } },
      { fill: { kind: 'color', value: '#102030' } },
    ]);
  });

  it('converts HSL, percentage RGB and CSS alpha values to canonical hex', () => {
    const source = '<svg viewBox="0 0 24 24">'
      + '<rect width="2" height="2" fill="hsl(120 100% 25%)"/>'
      + '<rect width="2" height="2" fill="hsla(240, 100%, 50%, 0.5)"/>'
      + '<rect width="2" height="2" fill="rgb(100% 50% 0% / 25%)"/>'
      + '<rect width="2" height="2" fill="rgba(16, 32, 48, 0)"/></svg>';
    const { icon } = canonicalizeSvgAst(parseSvgAst(source), options());
    expect(icon.nodes).toMatchObject([
      { fill: { kind: 'color', value: '#008000' } },
      { fill: { kind: 'color', value: '#0000ff80' } },
      { fill: { kind: 'color', value: '#ff800040' } },
      { fill: { kind: 'color', value: '#10203000' } },
    ]);
  });

  it('keeps inherited fill and stroke opacities separate from node opacity', () => {
    const source = '<svg viewBox="0 0 24 24" fill-opacity="0.5"><g stroke="#00ff00" stroke-opacity="0.25">'
      + '<rect width="4" height="4" fill="#ff000080" opacity="0.75"/>'
      + '<line x1="0" y1="0" x2="4" y2="4" stroke-opacity="0.5"/>'
      + '</g></svg>';
    const { icon } = canonicalizeSvgAst(parseSvgAst(source), options());
    const group = icon.nodes[0]!;
    if (group.type !== 'group') throw new Error('Expected group');
    expect(group.children).toMatchObject([
      { type: 'rect', opacity: 0.75, fill: { kind: 'color', value: '#ff000040' },
        stroke: { paint: { kind: 'color', value: '#00ff0040' } } },
      { type: 'line', stroke: { paint: { kind: 'color', value: '#00ff0080' } } },
    ]);
  });

  it('resolves geometry percentages against the root viewBox', () => {
    const source = '<svg viewBox="0 0 40 20" stroke="red" stroke-width="10%">'
      + '<rect x="25%" y="50%" width="50%" height="25%" rx="10%" ry="20%"/>'
      + '<circle cx="50%" cy="25%" r="10%"/>'
      + '<line x1="0%" y1="100%" x2="100%" y2="0%"/>'
      + '</svg>';
    const { icon } = canonicalizeSvgAst(parseSvgAst(source), options());
    const diagonal = Math.hypot(40, 20) / Math.SQRT2;
    expect(icon.nodes).toMatchObject([
      { type: 'rect', x: 10, y: 10, width: 20, height: 5, rx: 4, ry: 2.5,
        stroke: { width: Math.round(diagonal * 100) / 1000 } },
      { type: 'ellipse', cx: 20, cy: 5, rx: Math.round(diagonal * 100) / 1000 },
      { type: 'line', x1: 0, y1: 20, x2: 40, y2: 0 },
    ]);
  });

  it('clears an inherited dash pattern with stroke-dasharray none', () => {
    const source = '<svg viewBox="0 0 24 24" stroke="black" stroke-dasharray="2 1">'
      + '<line x1="0" y1="0" x2="8" y2="0"/>'
      + '<line x1="0" y1="2" x2="8" y2="2" stroke-dasharray="none"/>'
      + '</svg>';
    const { icon } = canonicalizeSvgAst(parseSvgAst(source), options());
    expect(icon.nodes[0]).toMatchObject({ type: 'line', stroke: { dash: [2, 1] } });
    expect(icon.nodes[1]).toMatchObject({ type: 'line' });
    if (icon.nodes[1]?.type !== 'line') throw new Error('Expected line');
    expect(icon.nodes[1].stroke.dash).toBeUndefined();
  });

  it('inherits evenodd fill rule and preserves it for polygons and paths', () => {
    const source = '<svg viewBox="0 0 24 24"><g fill-rule="evenodd"><polygon points="0 0 4 0 4 4 0 4"/><path d="M0 0 L2 0 Z"/></g></svg>';
    const { icon } = canonicalizeSvgAst(parseSvgAst(source), options());
    const group = icon.nodes[0]!;
    if (group.type !== 'group') throw new Error('Expected group');
    expect(group.children).toMatchObject([{ type: 'path', fillRule: 'evenodd' }, { type: 'path', fillRule: 'evenodd' }]);
  });
});
