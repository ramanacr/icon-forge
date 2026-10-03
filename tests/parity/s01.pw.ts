import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

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
      compiler: resolve('packages/compiler-core/src/index.ts'),
    },
    outdir: outputDir, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  });
  server = createServer(async (request, response) => {
    const name = request.url?.slice(1);
    if (!['quantization.js', 'canonical.js', 'application.js', 'model.js', 'compiler.js'].includes(name ?? '')) {
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
