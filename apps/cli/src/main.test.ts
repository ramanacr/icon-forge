import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ProjectV1 } from '@iconforge/project-model';
import { encodeProjectArchive } from '@iconforge/persistence';
import { compileSpriteProfile, compileSvgProfile } from '@iconforge/compiler-core';
import { runCli } from './main.js';

const id = (part: number): string => `0198e09b-a810-7000-8000-${part.toString(16).padStart(12, '0')}`;
const project: ProjectV1 = {
  schemaVersion: '1.0', id: id(1), name: 'CLI fixture', revision: 1,
  designSystem: { grid: { width: 24, height: 24 }, safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
    style: 'filled', stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 }, cornerRadius: 2,
    defaultPaintToken: 'currentColor', naming: { pattern: 'kebab', reserved: [] }, severities: {} },
  tokens: [], components: [], provenance: [],
  exportProfiles: [{ id: id(4), name: 'web-svg', target: 'svg',
    options: { precision: 3, sizeAttrs: false, paintMode: 'currentColor', metadata: false } }],
  icons: [{ id: id(2), name: 'box', aliases: [], tags: [], viewBox: [0, 0, 24, 24],
    variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [],
    nodes: [{ id: id(3), type: 'rect', visible: true, locked: false,
      x: 2, y: 2, width: 20, height: 20, rx: 0, ry: 0 }] }],
};

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('CLI compile', () => {
  it('compiles an archive with Node, checks hashes, and detects drift without writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iconforge-cli-'));
    directories.push(root);
    const input = join(root, 'project.iconproj');
    const out = join(root, 'dist');
    const archive = await encodeProjectArchive(project);
    await writeFile(input, archive);
    const command = ['compile', input, '--profile', 'web-svg', '--out', out];
    expect(await runCli(command)).toBe(0);
    const expected = compileSvgProfile(project, 'web-svg');
    expect(await readFile(join(out, 'box.svg'))).toEqual(Buffer.from(expected.artifacts['box.svg']!));
    expect(await readFile(join(out, 'manifest.json'))).toEqual(Buffer.from(expected.manifestBytes));
    expect(await runCli([...command, '--check'])).toBe(0);
    await writeFile(join(out, 'box.svg'), 'changed');
    expect(await runCli([...command, '--check'])).toBe(1);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runCli(command)).toBe(2);
    expect(await readFile(join(out, 'box.svg'), 'utf8')).toBe('changed');
    error.mockRestore();
    execFileSync(process.execPath, ['apps/cli/build.mjs', join(root, 'iconforge.mjs')], { cwd: process.cwd() });
    const output = execFileSync(process.execPath, [join(root, 'iconforge.mjs'), 'compile', input,
      '--profile', 'web-svg', '--out', join(root, 'node-output')], { cwd: process.cwd() });
    expect(output).toHaveLength(0);
    expect(await readFile(join(root, 'node-output', 'box.svg'))).toEqual(Buffer.from(expected.artifacts['box.svg']!));
  });

  it('classifies malformed project archives as invalid input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iconforge-cli-'));
    directories.push(root);
    const input = join(root, 'bad.iconproj');
    await writeFile(input, 'invalid archive');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runCli(['compile', input, '--profile', 'web-svg', '--out', join(root, 'dist')])).toBe(2);
    error.mockRestore();
  });

  it('compiles a sprite profile with the same bytes as the pure compiler', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iconforge-sprite-cli-'));
    directories.push(root);
    const input = join(root, 'project.iconproj');
    const out = join(root, 'dist');
    const spriteProject: ProjectV1 = { ...project, exportProfiles: [{ id: id(4), name: 'web-sprite',
      target: 'sprite', options: { idPrefix: 'if-', precision: 3 } }] };
    await writeFile(input, await encodeProjectArchive(spriteProject));
    const command = ['compile', input, '--profile', 'web-sprite', '--out', out];
    expect(await runCli(command)).toBe(0);
    const expected = compileSpriteProfile(spriteProject, 'web-sprite');
    for (const [path, bytes] of Object.entries(expected.artifacts)) {
      expect(await readFile(join(out, path))).toEqual(Buffer.from(bytes));
    }
    expect(await runCli([...command, '--check'])).toBe(0);
    const built = join(root, 'iconforge.mjs');
    execFileSync(process.execPath, ['apps/cli/build.mjs', built], { cwd: process.cwd() });
    execFileSync(process.execPath, [built, 'compile', input, '--profile', 'web-sprite',
      '--out', join(root, 'built-output')], { cwd: process.cwd() });
    expect(await readFile(join(root, 'built-output', 'sprite.svg'))).toEqual(Buffer.from(expected.artifacts['sprite.svg']!));
  });
});
