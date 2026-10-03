import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

let outputDir: string;
let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  outputDir = await mkdtemp(join(tmpdir(), 'iconforge-perf-'));
  await writeFile(join(outputDir, 'package.json'), '{"type":"module"}');
  await build({ entryPoints: {
    application: resolve('packages/application/src/index.ts'), model: resolve('packages/project-model/src/index.ts'),
    svg: resolve('packages/export-svg/src/index.ts'),
  }, outdir: outputDir, bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
  server = createServer(async (request, response) => {
    const name = request.url?.slice(1);
    if (!['application.js', 'model.js', 'svg.js'].includes(name ?? '')) {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html>'); return;
    }
    response.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(join(outputDir, name!)));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await rm(outputDir, { recursive: true, force: true });
});

test('Phase 0 validation, command history and SVG throughput budgets', async ({ page }, testInfo) => {
  await page.goto(baseUrl);
  const metrics = await page.evaluate(async () => {
    const { ProjectDispatcher } = await import(new URL('/application.js', location.origin).href);
    const { assertProject } = await import(new URL('/model.js', location.origin).href);
    const { serializeIconSvg } = await import(new URL('/svg.js', location.origin).href);
    const id = '0198e09b-a810-7000-8000-000000000080';
    const base = { commandVersion: '1.0', projectId: id, issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' } };
    const create = new ProjectDispatcher();
    create.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000081', type: 'project.create', payload: { id, name: 'Medical' } });
    const project = create.project;
    project.icons = Array.from({ length: 500 }, (_, index) => ({
      id: `0198e09b-a810-7000-8000-${(index + 1_000).toString(16).padStart(12, '0')}`,
      name: `icon-${index}`, aliases: [], tags: [], viewBox: [0, 0, 24, 24], variants: [], provenanceIds: [],
      accessibility: { kind: 'decorative' },
      nodes: [{ id: `0198e09b-a810-7000-8000-${(index + 2_000).toString(16).padStart(12, '0')}`,
        type: 'rect', visible: true, locked: false, x: 2, y: 2, width: 20, height: 20, rx: 2, ry: 2,
        fill: { kind: 'token', token: 'currentColor' } }],
    }));
    const validateStart = performance.now();
    assertProject(project);
    const validateMs = performance.now() - validateStart;
    const svgProject = { ...project, icons: project.icons.slice(0, 100) };
    const options = { precision: 3, paintMode: 'tokens', sizeAttrs: false, metadata: false };
    const svgStart = performance.now();
    const svgs = svgProject.icons.map((icon: unknown) => serializeIconSvg(svgProject, icon, options));
    const svgMs = performance.now() - svgStart;
    const dispatcher = new ProjectDispatcher(project);
    const applyTimes: number[] = [];
    const undoTimes: number[] = [];
    for (let index = 0; index < 30; index++) {
      const commandId = `0198e09b-a810-7000-8000-${(index + 3_000).toString(16).padStart(12, '0')}`;
      const undoId = `0198e09b-a810-7000-8000-${(index + 4_000).toString(16).padStart(12, '0')}`;
      const start = performance.now();
      dispatcher.dispatch({ ...base, commandId, type: 'icon.rename', payload: { iconId: project.icons[0].id, name: 'changed' } });
      applyTimes.push(performance.now() - start);
      const undoStart = performance.now();
      dispatcher.dispatch({ ...base, commandId: undoId, type: 'history.undo', payload: {} });
      undoTimes.push(performance.now() - undoStart);
    }
    const p95 = (samples: number[]): number => samples.sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!;
    return { validateMs, svgMs, svgCount: svgs.length, finalName: dispatcher.project.icons[0].name,
      applyP95Ms: p95(applyTimes), undoP95Ms: p95(undoTimes) };
  });
  expect(metrics.svgCount).toBe(100);
  expect(metrics.finalName).toBe('icon-0');
  if (testInfo.project.name === 'chromium') {
    expect(metrics.validateMs).toBeLessThanOrEqual(2_200);
    expect(metrics.svgMs).toBeLessThanOrEqual(2_200);
    expect(metrics.applyP95Ms).toBeLessThanOrEqual(55);
    expect(metrics.undoP95Ms).toBeLessThanOrEqual(55);
  }
});
