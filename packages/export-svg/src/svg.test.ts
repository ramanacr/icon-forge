import { describe, expect, it } from 'vitest';
import type { ProjectV1 } from '@iconforge/project-model';
import { serializeIconSvg } from './svg.js';

const project: ProjectV1 = {
  schemaVersion: '1.0', id: '0198e09b-a810-7000-8000-000000000001', name: 'Medical', revision: 1,
  designSystem: { grid: { width: 24, height: 24 }, safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
    style: 'outline', stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 }, cornerRadius: 2,
    defaultPaintToken: 'currentColor', naming: { pattern: 'kebab', reserved: [] }, severities: {} },
  tokens: [{ name: 'accent', light: '#112233', dark: '#ddeeff' }], components: [], exportProfiles: [], provenance: [],
  icons: [{ id: '0198e09b-a810-7000-8000-000000000002', name: 'medical-plus', aliases: [], tags: [],
    viewBox: [0, 0, 24, 24], variants: [], provenanceIds: [], accessibility: { kind: 'informative', label: 'Medical & care' },
    nodes: [{ id: '0198e09b-a810-7000-8000-000000000003', type: 'path', visible: true, locked: false,
      fillRule: 'nonzero', fill: { kind: 'none' }, stroke: { paint: { kind: 'token', token: 'accent' },
        width: 1.75, cap: 'round', join: 'round', miterLimit: 4 },
      path: [{ start: [2, 12], segments: [{ k: 'L', to: [22, 12] }], closed: false }] }],
  }],
};

describe('canonical SVG serializer', () => {
  it('emits a deterministic, escaped informative icon', () => {
    expect(serializeIconSvg(project, project.icons[0]!, { precision: 3, paintMode: 'tokens', sizeAttrs: false, metadata: false })).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img"><title>Medical &amp; care</title><path d="M2 12L22 12" fill="none" stroke="var(--if-accent)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="4" fill-rule="nonzero"/></svg>\n',
    );
  });

  it('resolves tokens for a decorative icon without browser-dependent formatting', () => {
    const modified: ProjectV1 = { ...project, icons: [{ ...project.icons[0]!, accessibility: { kind: 'decorative' } }] };
    const svg = serializeIconSvg(modified, modified.icons[0]!, { precision: 3, paintMode: 'resolved', sizeAttrs: true, metadata: false, theme: 'dark' });
    expect(svg).toContain('width="24" height="24" aria-hidden="true"');
    expect(svg).toContain('stroke="#ddeeff"');
    expect(svg).not.toContain('<title>');
  });

  it('keeps a narrow closed segment when export precision is lower than model precision', () => {
    const modified = structuredClone(project);
    const path = modified.icons[0]!.nodes[0]!;
    if (path.type !== 'path') throw new Error('Expected path fixture');
    path.path = [{ start: [0, 0], segments: [{ k: 'L', to: [0.001, 0] }, { k: 'L', to: [1, 1] }], closed: true }];
    const before = structuredClone(modified);
    const svg = serializeIconSvg(modified, modified.icons[0]!, { precision: 0, paintMode: 'currentColor', sizeAttrs: false, metadata: false });
    expect(svg).toContain('d="M0 0L0.001 0L1 1Z"');
    expect(modified).toEqual(before);
  });

  it('escapes title text and expands a static component instance', () => {
    const modified = structuredClone(project);
    modified.icons[0]!.accessibility.label = '<Care & "help">';
    expect(serializeIconSvg(modified, modified.icons[0]!, { precision: 3, paintMode: 'tokens', sizeAttrs: false, metadata: false }))
      .toContain('<title>&lt;Care &amp; &quot;help&quot;&gt;</title>');
    modified.components = [{ id: '0198e09b-a810-7000-8000-000000000004', name: 'base', parameters: [],
      nodes: [{ ...structuredClone(modified.icons[0]!.nodes[0]!), id: '0198e09b-a810-7000-8000-000000000006' }] }];
    modified.icons[0]!.nodes = [{ id: '0198e09b-a810-7000-8000-000000000005', type: 'instance', visible: true, locked: false,
      componentId: modified.components[0]!.id, arguments: {} }];
    expect(serializeIconSvg(modified, modified.icons[0]!, { precision: 3, paintMode: 'tokens', sizeAttrs: false, metadata: false }))
      .toContain('<g><path d="M2 12L22 12"');
  });

  it('renders a selected variant without changing the base icon', () => {
    const modified = structuredClone(project);
    modified.icons[0]!.variants = [{ id: '0198e09b-a810-7000-8000-000000000006', name: 'danger',
      dimensions: { state: 'danger' }, overrides: [{ op: 'setStroke', nodeId: modified.icons[0]!.nodes[0]!.id,
        stroke: { paint: { kind: 'color', value: '#ff0000' }, width: 2, cap: 'square', join: 'bevel', miterLimit: 4 } }] }];
    const before = structuredClone(modified);
    const base = serializeIconSvg(modified, modified.icons[0]!,
      { precision: 3, paintMode: 'resolved', sizeAttrs: false, metadata: false });
    const variant = serializeIconSvg(modified, modified.icons[0]!,
      { precision: 3, paintMode: 'resolved', sizeAttrs: false, metadata: false, variantId: modified.icons[0]!.variants[0]!.id });
    expect(base).toContain('stroke="#112233"');
    expect(variant).toContain('stroke="#ff0000" stroke-width="2" stroke-linecap="square"');
    expect(modified).toEqual(before);
  });

  it('applies nested replacement, transform and hide overrides in order', () => {
    const modified = structuredClone(project);
    const original = modified.icons[0]!.nodes[0]!;
    modified.icons[0]!.nodes = [{ id: '0198e09b-a810-7000-8000-000000000007', type: 'group', visible: true, locked: false,
      children: [original] }];
    modified.icons[0]!.variants = [
      { id: '0198e09b-a810-7000-8000-000000000008', name: 'replacement', dimensions: { state: 'replacement' },
        overrides: [
          { op: 'setTransform', nodeId: modified.icons[0]!.nodes[0]!.id, transform: [1, 0, 0, 1, 2, 3] },
          { op: 'replaceNode', nodeId: original.id, node: { id: '0198e09b-a810-7000-8000-000000000010',
            type: 'rect', visible: true, locked: false, x: 4, y: 4, width: 8, height: 8, rx: 0, ry: 0,
            fill: { kind: 'color', value: '#00ff00' } } },
        ] },
      { id: '0198e09b-a810-7000-8000-000000000009', name: 'hidden', dimensions: { state: 'hidden' },
        overrides: [{ op: 'hide', nodeId: original.id }] },
    ];
    const options = { precision: 3 as const, paintMode: 'resolved' as const, sizeAttrs: false, metadata: false };
    const replaced = serializeIconSvg(modified, modified.icons[0]!, { ...options, variantId: modified.icons[0]!.variants[0]!.id });
    const hidden = serializeIconSvg(modified, modified.icons[0]!, { ...options, variantId: modified.icons[0]!.variants[1]!.id });
    expect(replaced).toContain('<g transform="matrix(1 0 0 1 2 3)"><rect');
    expect(replaced).toContain('fill="#00ff00"');
    expect(replaced).not.toContain('<path');
    expect(hidden).not.toContain('<path');
    expect(() => serializeIconSvg(modified, modified.icons[0]!, { ...options, variantId: '0198e09b-a810-7000-8000-000000000099' }))
      .toThrow('svg.variant.not-found');
  });

  it('refuses parameterized components until their field bindings are defined', () => {
    const modified = structuredClone(project);
    modified.components = [{ id: '0198e09b-a810-7000-8000-000000000004', name: 'parametric',
      parameters: [{ name: 'strokeWidth', type: 'number', default: 2, min: 0, max: 10 }],
      nodes: [{ ...structuredClone(modified.icons[0]!.nodes[0]!), id: '0198e09b-a810-7000-8000-000000000006' }] }];
    modified.icons[0]!.nodes = [{ id: '0198e09b-a810-7000-8000-000000000005', type: 'instance', visible: true, locked: false,
      componentId: modified.components[0]!.id, arguments: { strokeWidth: 3 } }];
    expect(() => serializeIconSvg(modified, modified.icons[0]!,
      { precision: 3, paintMode: 'tokens', sizeAttrs: false, metadata: false }))
      .toThrow('svg.instance.parameters-unbound');
  });

  it('rejects arguments supplied to a static component', () => {
    const modified = structuredClone(project);
    modified.components = [{ id: '0198e09b-a810-7000-8000-000000000004', name: 'base', parameters: [], nodes: [] }];
    modified.icons[0]!.nodes = [{ id: '0198e09b-a810-7000-8000-000000000005', type: 'instance', visible: true, locked: false,
      componentId: modified.components[0]!.id, arguments: { unused: 2 } }];
    expect(() => serializeIconSvg(modified, modified.icons[0]!,
      { precision: 3, paintMode: 'tokens', sizeAttrs: false, metadata: false }))
      .toThrow('svg.instance.arguments-unbound');
  });
});
