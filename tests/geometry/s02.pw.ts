import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

let outputDir: string;
let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  outputDir = await mkdtemp(join(tmpdir(), 'iconforge-s02-'));
  await writeFile(join(outputDir, 'package.json'), '{"type":"module"}');
  await build({ entryPoints: [resolve('packages/geometry-paper/src/worker-spike.ts')], outfile: join(outputDir, 'worker.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    alias: { paper: resolve('packages/geometry-paper/node_modules/paper/dist/paper-core.js') } });
  const minified = await build({ entryPoints: [resolve('packages/geometry-paper/src/worker-spike.ts')],
    bundle: true, write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022',
    alias: { paper: resolve('packages/geometry-paper/node_modules/paper/dist/paper-core.js') } });
  expect(gzipSync(minified.outputFiles[0]!.contents, { level: 9 }).length).toBeLessThanOrEqual(120 * 1024);
  server = createServer(async (request, response) => {
    if (request.url !== '/worker.js') { response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html>'); return; }
    response.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(join(outputDir, 'worker.js')));
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

test('S-02 Paper.js runs a Boolean in a DOM-free worker', async ({ page }) => {
  await page.goto(baseUrl);
  const result = await page.evaluate(async () => new Promise<unknown>((resolve, reject) => {
    const worker = new Worker('/worker.js', { type: 'module' });
    worker.onmessage = event => { worker.terminate(); resolve(event.data); };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage({});
  }));
  expect(result).toMatchObject({ domAvailable: false, canvasAvailable: false, inputsUnchanged: true, canonicalInputsUnchanged: true,
    areas: { union: 150, subtract: 50, intersect: 50, exclude: 100 },
    edgeAreas: { coincidentUnion: 100, coincidentIntersect: 100, touchingUnion: 200, touchingIntersect: 0 },
    canonicalResult: { diagnostics: [], path: expect.any(Array) },
    invalidResult: { path: null, diagnostics: [{ code: 'boolean.invalid-input', severity: 'error' }] } });
  const canonical = (result as { canonicalResult: { path: Array<{ start: [number, number]; segments: Array<{ to: [number, number] }>; closed: boolean }> } }).canonicalResult;
  expect(canonical.path.length).toBeGreaterThan(0);
  const area = canonical.path.reduce((total, subpath) => {
    expect(subpath.closed).toBe(true);
    const points = [subpath.start, ...subpath.segments.map(segment => segment.to)];
    for (const point of points) for (const coordinate of point) expect(coordinate * 1000).toBeCloseTo(Math.round(coordinate * 1000), 6);
    return total + Math.abs(points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]!;
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2);
  }, 0);
  expect(area).toBeCloseTo(150, 3);
});
