import { describe, expect, it } from 'vitest';
import { serializeIconSvg } from '@iconforge/export-svg';
import type { ProjectV1 } from '@iconforge/project-model';
import { canonicalJson } from '@iconforge/project-model';
import { compileSvgProfile } from './svg-profile.js';

const id = (part: number): string => `0198e09b-a810-7000-8000-${part.toString(16).padStart(12, '0')}`;
const project: ProjectV1 = {
  schemaVersion: '1.0', id: id(1), name: 'Medical', revision: 1,
  designSystem: { grid: { width: 24, height: 24 }, safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
    style: 'filled', stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 }, cornerRadius: 2,
    defaultPaintToken: 'currentColor', naming: { pattern: 'kebab', reserved: [] }, severities: {} },
  tokens: [], components: [], provenance: [],
  exportProfiles: [{ id: id(4), name: 'web-svg', target: 'svg',
    options: { precision: 3, sizeAttrs: false, paintMode: 'currentColor', metadata: false } }],
  icons: [2, 3].map((part, index) => ({ id: id(part), name: index === 0 ? 'zeta' : 'alpha',
    aliases: [], tags: [], viewBox: [0, 0, 24, 24], variants: [],
    accessibility: { kind: 'decorative' }, provenanceIds: [],
    nodes: [{ id: id(part + 10), type: 'rect', visible: true, locked: false,
      x: index, y: 0, width: 8, height: 8, rx: 0, ry: 0 }],
  })),
};

describe('SVG profile compiler', () => {
  it('emits sorted, hashed SVG artifacts without mutating the project', () => {
    const before = canonicalJson(project);
    const result = compileSvgProfile(project, 'web-svg');
    expect(Object.keys(result.artifacts)).toEqual(['alpha.svg', 'zeta.svg']);
    expect(result.manifest.artifacts.map(artifact => artifact.path)).toEqual(['alpha.svg', 'zeta.svg']);
    const zeta = new TextDecoder().decode(result.artifacts['zeta.svg']);
    const profile = project.exportProfiles[0]!;
    if (profile.target !== 'svg') throw new Error('Expected SVG profile');
    expect(zeta).toBe(serializeIconSvg(project, project.icons[0]!, profile.options));
    expect(result.manifest.format).toBe('iconforge-build');
    expect(new TextDecoder().decode(result.manifestBytes)).toBe(canonicalJson(result.manifest));
    expect(canonicalJson(project)).toBe(before);
    expect(compileSvgProfile(project, 'web-svg')).toEqual(result);
  });

  it('rejects missing and non-SVG profiles', () => {
    expect(() => compileSvgProfile(project, 'missing')).toThrow('compile.profile.not-found');
    const png = structuredClone(project);
    png.exportProfiles[0] = { id: id(4), name: 'web-png', target: 'png',
      options: { sizes: [48], theme: 'light', padding: 0 } };
    expect(() => compileSvgProfile(png, 'web-png')).toThrow('compile.profile.unsupported');
    const duplicate = structuredClone(project);
    duplicate.exportProfiles.push({ ...duplicate.exportProfiles[0]!, id: id(5) });
    expect(() => compileSvgProfile(duplicate, 'web-svg')).toThrow('compile.profile.ambiguous');
  });
});
