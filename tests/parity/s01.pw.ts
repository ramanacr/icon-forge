import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';
import type { ProjectV1, SceneNodeV1 } from '../../packages/project-model/src/types.js';

const sourceDir = resolve('packages/project-model/src');
const goldenSha256 = '33f5f4ac03efa3b64f81218335455f8dde6fa536317a70cc018f83c1b24eec9d';
const replayGoldenSha256 = '38c845166678bd1515b504be7896ca9397d2abb7a4c4970359b76062fee87aea';
const svgGoldenSha256 = 'a97ce291647a5d1ba2dd139f51ad01a543ea645856298f1c826e2be27f69df4b';
let outputDir: string;
let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  outputDir = await mkdtemp(join(tmpdir(), 'iconforge-s01-'));
  await writeFile(join(outputDir, 'package.json'), '{"type":"module"}');
  for (const file of ['quantization', 'canonical']) {
    const source = await readFile(join(sourceDir, `${file}.ts`), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    await writeFile(join(outputDir, `${file}.js`), compiled.outputText);
  }
  await build({
    entryPoints: {
      application: resolve('packages/application/src/index.ts'),
      model: resolve('packages/project-model/src/index.ts'),
      compiler: resolve('packages/export-svg/src/index.ts'),
      profileCompiler: resolve('packages/compiler-core/src/index.ts'),
    },
    outdir: outputDir, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  });
  server = createServer(async (request, response) => {
    const name = request.url?.slice(1);
    if (!['quantization.js', 'canonical.js', 'application.js', 'model.js', 'compiler.js', 'profileCompiler.js'].includes(name ?? '')) {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(join(outputDir, name!)));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test('S-01 canonical SVG fixture matches Node and the browser', async ({ page }) => {
  const application = await import(pathToFileURL(join(outputDir, 'application.js')).href);
  const compiler = await import(pathToFileURL(join(outputDir, 'compiler.js')).href);
  const id = '0198e09b-a810-7000-8000-000000000040';
  const base = { commandVersion: '1.0', projectId: id, issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' } };
  const create = { ...base, commandId: '0198e09b-a810-7000-8000-000000000041', type: 'project.create', payload: { id, name: 'Medical' } };
  const icon = { id: '0198e09b-a810-7000-8000-000000000042', name: 'medical-plus', aliases: [], tags: [],
    viewBox: [0, 0, 24, 24], variants: [], provenanceIds: [], accessibility: { kind: 'informative', label: 'Medical & care' },
    nodes: [
      { id: '0198e09b-a810-7000-8000-000000000043', type: 'path', visible: true, locked: false,
        fillRule: 'nonzero', fill: { kind: 'none' }, stroke: { paint: { kind: 'token', token: 'currentColor' },
          width: 1.75, cap: 'round', join: 'round', miterLimit: 4 },
        path: [{ start: [2, 12], segments: [{ k: 'L', to: [22, 12] }], closed: false }] },
      { id: '0198e09b-a810-7000-8000-000000000044', type: 'rect', visible: true, locked: false,
        x: 10.5, y: 2, width: 3, height: 20, rx: 0.5, ry: 0.5, fill: { kind: 'token', token: 'currentColor' } },
    ] };
  const add = { ...base, commandId: '0198e09b-a810-7000-8000-000000000045', type: 'icon.add', payload: { icon } };
  const options = { precision: 3, paintMode: 'tokens', sizeAttrs: false, metadata: false };
  const dispatcher = new application.ProjectDispatcher();
  dispatcher.dispatch(create);
  dispatcher.dispatch(add);
  const nodeSvg: string = compiler.serializeIconSvg(dispatcher.project, dispatcher.project.icons[0], options);
  expect(createHash('sha256').update(nodeSvg).digest('hex')).toBe(svgGoldenSha256);

  await page.goto(baseUrl);
  const browserSvg = await page.evaluate(async ({ create, add, options }) => {
    const application = await import(new URL('/application.js', location.origin).href);
    const compiler = await import(new URL('/compiler.js', location.origin).href);
    const dispatcher = new application.ProjectDispatcher();
    dispatcher.dispatch(create);
    dispatcher.dispatch(add);
    return compiler.serializeIconSvg(dispatcher.project, dispatcher.project.icons[0], options);
  }, { create, add, options });
  expect(browserSvg).toBe(nodeSvg);
});

test('S-01 static component and selected variant SVG match Node and Chromium', async ({ page }) => {
  const compiler = await import(pathToFileURL(join(outputDir, 'compiler.js')).href);
  const id = (number: number): string => `0198e09b-a810-7000-8000-${number.toString(16).padStart(12, '0')}`;
  const componentNode: SceneNodeV1 = { id: id(4), type: 'rect', visible: true, locked: false,
    x: 2, y: 2, width: 20, height: 20, rx: 0, ry: 0, fill: { kind: 'color', value: '#334455' } };
  const instance: SceneNodeV1 = { id: id(5), type: 'instance', visible: true, locked: false,
    componentId: id(3), arguments: {} };
  const project: ProjectV1 = { schemaVersion: '1.0', id: id(1), name: 'Variant corpus', revision: 1,
    designSystem: { grid: { width: 24, height: 24 }, safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
      style: 'filled', stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 }, cornerRadius: 2,
      defaultPaintToken: 'currentColor', naming: { pattern: 'kebab', reserved: [] }, severities: {} },
    tokens: [], components: [{ id: id(3), name: 'base', parameters: [], nodes: [componentNode] }],
    exportProfiles: [], provenance: [], icons: [{ id: id(2), name: 'component-icon', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], nodes: [instance], accessibility: { kind: 'decorative' }, provenanceIds: [],
      variants: [{ id: id(6), name: 'shifted', dimensions: { state: 'shifted' },
        overrides: [{ op: 'setTransform', nodeId: instance.id, transform: [1, 0, 0, 1, 2, 3] }] }] }] };
  const options = { precision: 3 as const, paintMode: 'resolved' as const, sizeAttrs: false, metadata: false,
    variantId: id(6) };
  const before = structuredClone(project);
  const nodeSvg: string = compiler.serializeIconSvg(project, project.icons[0], options);
  expect(nodeSvg).toContain('<g transform="matrix(1 0 0 1 2 3)"><rect');
  expect(project).toEqual(before);
  await page.goto(baseUrl);
  const browserSvg = await page.evaluate(async ({ project, options }) => {
    const compiler = await import(new URL('/compiler.js', location.origin).href);
    return compiler.serializeIconSvg(project, project.icons[0], options);
  }, { project, options });
  expect(browserSvg).toBe(nodeSvg);
});

test('S-01 parameterized component SVG matches Node and Chromium', async ({ page }) => {
  const compiler = await import(pathToFileURL(join(outputDir, 'compiler.js')).href);
  const id = (number: number): string => `0198e09b-a810-7000-8000-${number.toString(16).padStart(12, '0')}`;
  const project: ProjectV1 = { schemaVersion: '1.0', id: id(31), name: 'Bound component', revision: 1,
    designSystem: { grid: { width: 24, height: 24 }, safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
      style: 'filled', stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 }, cornerRadius: 2,
      defaultPaintToken: 'currentColor', naming: { pattern: 'kebab', reserved: [] }, severities: {} },
    tokens: [], components: [{ id: id(33), name: 'rounded-box',
      parameters: [{ name: 'radius', type: 'number', default: 1, min: 0, max: 4 }],
      bindings: [{ parameter: 'radius', nodeId: id(34), field: 'rx' },
        { parameter: 'radius', nodeId: id(34), field: 'ry' }],
      nodes: [{ id: id(34), type: 'rect', visible: true, locked: false,
        x: 2, y: 2, width: 20, height: 20, rx: 0, ry: 0 }] }],
    exportProfiles: [], provenance: [], icons: [{ id: id(32), name: 'bound-icon', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], accessibility: { kind: 'decorative' }, provenanceIds: [], variants: [],
      nodes: [{ id: id(35), type: 'instance', visible: true, locked: false,
        componentId: id(33), arguments: { radius: 3 } }] }] };
  const options = { precision: 3 as const, paintMode: 'resolved' as const, sizeAttrs: false, metadata: false };
  const nodeSvg: string = compiler.serializeIconSvg(project, project.icons[0], options);
  expect(nodeSvg).toContain('rx="3" ry="3"');
  await page.goto(baseUrl);
  const browserSvg = await page.evaluate(async ({ project, options }) => {
    const compiler = await import(new URL('/compiler.js', location.origin).href);
    return compiler.serializeIconSvg(project, project.icons[0], options);
  }, { project, options });
  expect(browserSvg).toBe(nodeSvg);
});

test('Phase 1 SVG profile artifacts and manifest match Node and Chromium', async ({ page }) => {
  const application = await import(pathToFileURL(join(outputDir, 'application.js')).href);
  const compiler = await import(pathToFileURL(join(outputDir, 'profileCompiler.js')).href);
  const id = (part: number): string => `0198e09b-a810-7000-8000-${part.toString(16).padStart(12, '0')}`;
  const base = { commandVersion: '1.0', projectId: id(51), issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' } };
  const dispatcher = new application.ProjectDispatcher();
  dispatcher.dispatch({ ...base, commandId: id(52), type: 'project.create', payload: { id: id(51), name: 'CLI parity' } });
  dispatcher.dispatch({ ...base, commandId: id(53), type: 'icon.add', payload: { icon: {
    id: id(54), name: 'box', aliases: [], tags: [], viewBox: [0, 0, 24, 24], variants: [],
    provenanceIds: [], accessibility: { kind: 'decorative' }, nodes: [
      { id: id(55), type: 'rect', visible: true, locked: false, x: 2, y: 2, width: 20, height: 20, rx: 1, ry: 1 },
    ],
  } } });
  dispatcher.dispatch({ ...base, commandId: id(56), type: 'exportProfile.upsert', payload: { profile: {
    id: id(57), name: 'web-svg', target: 'svg',
    options: { precision: 3, sizeAttrs: false, paintMode: 'currentColor', metadata: false },
  } } });
  const project: ProjectV1 = dispatcher.project;
  const build = compiler.compileSvgProfile(project, 'web-svg');
  await page.goto(baseUrl);
  const browser = await page.evaluate(async project => {
    const module = await import(new URL('/profileCompiler.js', location.origin).href);
    const output = module.compileSvgProfile(project, 'web-svg');
    return { svg: new TextDecoder().decode(output.artifacts['box.svg']),
      manifest: new TextDecoder().decode(output.manifestBytes) };
  }, project);
  expect(browser.svg).toBe(new TextDecoder().decode(build.artifacts['box.svg']));
  expect(browser.manifest).toBe(new TextDecoder().decode(build.manifestBytes));
});

test.afterAll(async () => {
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await rm(outputDir, { recursive: true, force: true });
});

test('S-01 canonical numeric fixture matches Node and the browser', async ({ page }) => {
  const { quantize, quantizeMatrix } = await import(pathToFileURL(join(outputDir, 'quantization.js')).href);
  const { canonicalJson } = await import(pathToFileURL(join(outputDir, 'canonical.js')).href);
  const nodeArtifact = canonicalJson({ bounds: [quantize(1.2345), quantize(-1.2355), quantizeMatrix([1.0000006, 0, 0, 1, 2.0006, -2.0006])], tiny: 1e-7 });
  expect(createHash('sha256').update(nodeArtifact).digest('hex')).toBe(goldenSha256);

  await page.goto(baseUrl);
  const browserArtifact = await page.evaluate(async () => {
    const q = await import(new URL('/quantization.js', location.origin).href);
    const c = await import(new URL('/canonical.js', location.origin).href);
    return c.canonicalJson({ bounds: [q.quantize(1.2345), q.quantize(-1.2355), q.quantizeMatrix([1.0000006, 0, 0, 1, 2.0006, -2.0006])], tiny: 1e-7 });
  });
  expect(browserArtifact).toBe(nodeArtifact);
});

test('S-01 journal replay matches Node and the browser', async ({ page }) => {
  const application = await import(pathToFileURL(join(outputDir, 'application.js')).href);
  const model = await import(pathToFileURL(join(outputDir, 'model.js')).href);
  const id = '0198e09b-a810-7000-8000-000000000001';
  const base = { commandVersion: '1.0', projectId: id, issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' } };
  const create = { ...base, commandId: '0198e09b-a810-7000-8000-000000000002', type: 'project.create', payload: { id, name: 'Medical' } };
  const rename = { ...base, commandId: '0198e09b-a810-7000-8000-000000000003', type: 'project.rename', payload: { name: 'Clinical' }, expectedRevision: 1 };
  const dispatcher = new application.ProjectDispatcher();
  dispatcher.dispatch(create);
  dispatcher.dispatch(rename);
  const nodeReplay = application.ProjectDispatcher.replay(null, dispatcher.journal);
  const nodeArtifact = model.canonicalJson(nodeReplay.project);
  const nodeChecksums = dispatcher.journal.map((entry: { checksum: string }) => entry.checksum);
  expect(createHash('sha256').update(nodeArtifact).digest('hex')).toBe(replayGoldenSha256);

  await page.goto(baseUrl);
  const browserResult = await page.evaluate(async ({ create, rename }) => {
    const application = await import(new URL('/application.js', location.origin).href);
    const model = await import(new URL('/model.js', location.origin).href);
    const dispatcher = new application.ProjectDispatcher();
    dispatcher.dispatch(create);
    dispatcher.dispatch(rename);
    const replay = application.ProjectDispatcher.replay(null, dispatcher.journal);
    return { artifact: model.canonicalJson(replay.project), checksums: dispatcher.journal.map((entry: { checksum: string }) => entry.checksum) };
  }, { create, rename });
  expect(browserResult.artifact).toBe(nodeArtifact);
  expect(browserResult.checksums).toEqual(nodeChecksums);
});

test('S-01 deterministic corpus has pinned JSON and SVG hashes', async ({ page }) => {
  const id = (number: number): string => `0198e09b-a810-7000-8000-${number.toString(16).padStart(12, '0')}`;
  const rect = (number: number): Extract<SceneNodeV1, { type: 'rect' }> => ({ id: id(number), type: 'rect', visible: true, locked: false,
    x: 2, y: 2, width: 20, height: 20, rx: 1, ry: 1, fill: { kind: 'token', token: 'currentColor' } });
  const makeProject = (name: string, nodes: SceneNodeV1[]): ProjectV1 => ({
    schemaVersion: '1.0', id: id(1), name: 'Corpus', revision: 1,
    designSystem: { grid: { width: 24, height: 24 }, safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
      style: 'filled', stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 }, cornerRadius: 2,
      defaultPaintToken: 'currentColor', naming: { pattern: 'kebab', reserved: [] }, severities: {} },
    tokens: [], components: [], exportProfiles: [], provenance: [], icons: [{ id: id(2), name, aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], nodes, variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [] }],
  });
  const fixtures: Record<string, ProjectV1> = {
    'rotate-15deg': makeProject('rotate-15deg', [{ ...rect(3), transform: [0.965926, 0.258819, -0.258819, 0.965926, 0, 0] }]),
    'rotate-arbitrary': makeProject('rotate-arbitrary', [{ ...rect(3), transform: [0.955279, 0.295708, -0.295708, 0.955279, 1.25, -2.5] }]),
    'scale-non-uniform': makeProject('scale-non-uniform', [{ id: id(3), type: 'group', visible: true, locked: false,
      transform: [1.5, 0, 0, 0.75, -0, 2.5], children: [rect(4)] }]),
    'arc-to-cubic': makeProject('arc-to-cubic', [{ id: id(3), type: 'path', visible: true, locked: false,
      fillRule: 'nonzero', fill: { kind: 'none' }, stroke: { paint: { kind: 'token', token: 'currentColor' },
        width: 1.75, cap: 'round', join: 'round', miterLimit: 4 },
      path: [{ start: [0, 12], segments: [{ k: 'C', c1: [0, 5.373], c2: [5.373, 0], to: [12, 0] }], closed: false }] }]),
    'quantize-half-even-boundary': makeProject('quantize-half-even-boundary', [{ ...rect(3), x: 1.234, y: -1.236 }]),
    'negative-zero': makeProject('negative-zero', [{ ...rect(3), x: -0, y: -0 }]),
  };
  const large = makeProject('icon-000', [rect(3)]);
  large.icons = Array.from({ length: 500 }, (_, index) => ({ ...structuredClone(large.icons[0]!),
    id: id(1000 + index), name: `icon-${String(index).padStart(3, '0')}`,
    nodes: [rect(2000 + index)] }));
  fixtures['large-project-serialize'] = large;
  const options = { precision: 3 as const, paintMode: 'tokens' as const, sizeAttrs: false, metadata: false };
  const model = await import(pathToFileURL(join(outputDir, 'model.js')).href);
  const compiler = await import(pathToFileURL(join(outputDir, 'compiler.js')).href);
  const boundary = [model.quantize(1.2345), model.quantize(-1.2355), model.quantize(-0)];
  expect(boundary).toEqual([1.234, -1.236, 0]);
  const nodeHashes = Object.fromEntries(Object.entries(fixtures).map(([name, project]) => [name, {
    json: createHash('sha256').update(model.canonicalJson(project)).digest('hex'),
    svg: createHash('sha256').update(compiler.serializeIconSvg(project, project.icons[0], options)).digest('hex'),
  }]));
  const goldenHashes: Record<string, { json: string; svg: string }> = {
    'arc-to-cubic': { json: 'f0bc6716bc502993dada7a0f22fc4374924a97ad8726deb77d04b7969d22fc25',
      svg: 'd709224123dcc251da31140caa9fb06e1a68683064d8f21817d8ccf99c5d352e' },
    'large-project-serialize': { json: '233cbd322fd5e21180fccebe5606994931c12ab42416ca784029d52f9fa0c9c4',
      svg: '749ef28b002e95b4ae7e4a5b8b542a8bfcb517368026063101cb03f0a693af6f' },
    'negative-zero': { json: 'e23860383f09c5546c561e32b30161aafc9b6f149cae873a97f112cf41a11f6c',
      svg: '24ffcf863f4b236b29026236d0ae596c6a56e566eb6750aa22b619306c138c30' },
    'quantize-half-even-boundary': { json: '16b9a7630eedb669f08a863ed44e5fecbdc9a961a0f665cbaa320cf7ad85f7a5',
      svg: 'f78c137307c268337cd79e5ab5c818f9a0e636ed51cd2b3448324455247b86e1' },
    'rotate-15deg': { json: '297ad7a40292fde8b73f4dfe9cc6785dbd8289d1e8a5a35db1a93de40955bdaf',
      svg: 'cbe4aee2eb2667940d830b551c90063b597191d644fe3ec418930be99eee01ea' },
    'rotate-arbitrary': { json: 'dc908f17656856764adcfae4172f702f42502dff5d40d27ece3e8d112c508051',
      svg: '5ba9a2d026683d217c4a7115f2d57dfc9d7e3cac0a516d285462334a7b5c6697' },
    'scale-non-uniform': { json: 'c8a81414e0a1dc0edeb9b9996ebb11c425c6266a1e808dd85ca4287667ab0822',
      svg: 'd4bcbbd37386d02c97d05a0cd095282152d5e840d387cea8710c85740a4b1682' },
  };
  expect(nodeHashes).toEqual(goldenHashes);
  await page.goto(baseUrl);
  const browserHashes = await page.evaluate(async ({ fixtures, options }) => {
    const model = await import(new URL('/model.js', location.origin).href);
    const compiler = await import(new URL('/compiler.js', location.origin).href);
    const sha = async (value: string): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
    return Object.fromEntries(await Promise.all(Object.entries(fixtures).map(async ([name, project]) => [name, {
      json: await sha(model.canonicalJson(project)),
      svg: await sha(compiler.serializeIconSvg(project, project.icons[0], options)),
    }])));
  }, { fixtures, options });
  expect(browserHashes).toEqual(nodeHashes);
  const browserBoundary = await page.evaluate(async () => {
    const model = await import(new URL('/model.js', location.origin).href);
    return [model.quantize(1.2345), model.quantize(-1.2355), model.quantize(-0)];
  });
  expect(browserBoundary).toEqual(boundary);
});
