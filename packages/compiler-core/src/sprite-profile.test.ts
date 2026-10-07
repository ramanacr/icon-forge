import { describe, expect, it } from 'vitest';
import { canonicalJson, type ProjectV1 } from '@iconforge/project-model';
import { compileSpriteProfile } from './sprite-profile.js';

const id = (part: number): string => `0198e09b-a810-7000-8000-${part.toString(16).padStart(12, '0')}`;
const project: ProjectV1 = {
  schemaVersion: '1.0', id: id(1), name: 'Medical', revision: 1,
  designSystem: { grid: { width: 24, height: 24 }, safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
    style: 'filled', stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 }, cornerRadius: 2,
    defaultPaintToken: 'currentColor', naming: { pattern: 'kebab', reserved: [] }, severities: {} },
  tokens: [], components: [], provenance: [],
  exportProfiles: [{ id: id(4), name: 'web-sprite', target: 'sprite', options: { idPrefix: 'if-', precision: 3 } }],
  icons: [{ id: id(2), name: 'star', aliases: [], tags: [], viewBox: [0, 0, 24, 24],
    accessibility: { kind: 'decorative' }, provenanceIds: [],
    nodes: [{ id: id(5), type: 'rect', visible: true, locked: false,
      x: 1, y: 2, width: 8, height: 8, rx: 0, ry: 0 }],
    variants: [{ id: id(6), name: 'filled', dimensions: { style: 'filled' },
      overrides: [{ op: 'setFill', nodeId: id(5), fill: { kind: 'color', value: '#ff0000' } }] }],
  }],
};

describe('sprite profile compiler', () => {
  it('emits deterministic symbols for icons and variants with a usage page and manifest', () => {
    const before = canonicalJson(project);
    const build = compileSpriteProfile(project, 'web-sprite');
    const sprite = new TextDecoder().decode(build.artifacts['sprite.svg']);
    const usage = new TextDecoder().decode(build.artifacts['usage.html']);
    expect(sprite).toContain('<symbol id="if-star" viewBox="0 0 24 24"><rect');
    expect(sprite).toContain('<symbol id="if-star-filled" viewBox="0 0 24 24"><rect');
    expect(sprite).toContain('fill="#ff0000"');
    expect(usage).toContain('sprite.svg#if-star-filled');
    expect(build.manifest.artifacts.map(item => item.path)).toEqual(['sprite.svg', 'usage.html']);
    expect(new TextDecoder().decode(build.manifestBytes)).toBe(canonicalJson(build.manifest));
    expect(compileSpriteProfile(project, 'web-sprite')).toEqual(build);
    expect(canonicalJson(project)).toBe(before);
  });

  it('rejects colliding and invalid generated symbol IDs', () => {
    const collision = structuredClone(project);
    collision.icons[0]!.name = 'foo';
    collision.icons[0]!.variants[0]!.name = 'bar';
    collision.icons.push({ ...structuredClone(collision.icons[0]!), id: id(7), name: 'foo-bar',
      nodes: [{ ...collision.icons[0]!.nodes[0]!, id: id(8) }], variants: [] });
    expect(() => compileSpriteProfile(collision, 'web-sprite')).toThrow('sprite.id-collision');
    const invalid = structuredClone(project);
    if (invalid.exportProfiles[0]?.target !== 'sprite') throw new Error('Expected sprite profile');
    invalid.exportProfiles[0].options.idPrefix = '<bad';
    expect(() => compileSpriteProfile(invalid, 'web-sprite')).toThrow('sprite.id-invalid');
  });
});
