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
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
  const minified = await build({ entryPoints: [resolve('packages/geometry-paper/src/worker-spike.ts')],
    bundle: true, write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022' });
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
  const iouByOperation = await page.evaluate((operations: Record<string, { path: Array<{
    start: [number, number]; segments: Array<{ k: 'L' | 'Q' | 'C'; to: [number, number]; c?: [number, number];
      c1?: [number, number]; c2?: [number, number] }>; closed: boolean }>; diagnostics: unknown[] }>) => {
    const operationModes: Record<string, GlobalCompositeOperation> = {
      union: 'source-over', subtract: 'destination-out', intersect: 'source-in', exclude: 'xor',
    };
    const occupancy = (canvas: HTMLCanvasElement): Uint8Array => {
      const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      return Uint8Array.from({ length: canvas.width * canvas.height }, (_, index) => rgba[index * 4 + 3]! > 127 ? 1 : 0);
    };
    const makeCanvas = (): HTMLCanvasElement => { const canvas = document.createElement('canvas'); canvas.width = 220; canvas.height = 120; return canvas; };
    return Object.fromEntries(Object.entries(operations).map(([name, output]) => {
      const reference = makeCanvas();
      const referenceContext = reference.getContext('2d')!;
      referenceContext.scale(10, 10);
      referenceContext.fillRect(0, 0, 10, 10);
      referenceContext.globalCompositeOperation = operationModes[name]!;
      referenceContext.fillRect(5, 0, 10, 10);
      const actual = makeCanvas();
      const actualContext = actual.getContext('2d')!;
      actualContext.scale(10, 10);
      const path = new Path2D();
      for (const subpath of output.path) {
        path.moveTo(...subpath.start);
        for (const segment of subpath.segments) {
          if (segment.k === 'L') path.lineTo(...segment.to);
          else if (segment.k === 'Q') path.quadraticCurveTo(...segment.c!, ...segment.to);
          else path.bezierCurveTo(...segment.c1!, ...segment.c2!, ...segment.to);
        }
        if (subpath.closed) path.closePath();
      }
      actualContext.fill(path);
      const expected = occupancy(reference);
      const observed = occupancy(actual);
      let intersection = 0;
      let union = 0;
      for (let index = 0; index < expected.length; index++) {
        if (expected[index] && observed[index]) intersection++;
        if (expected[index] || observed[index]) union++;
      }
      return [name, union === 0 ? 1 : intersection / union];
    }));
  }, (result as { canonicalOperations: Record<string, { path: Array<{ start: [number, number]; segments: Array<{
    k: 'L' | 'Q' | 'C'; to: [number, number]; c?: [number, number]; c1?: [number, number]; c2?: [number, number] }>; closed: boolean }>; diagnostics: unknown[] }> }).canonicalOperations);
  for (const [operation, iou] of Object.entries(iouByOperation)) expect(iou, operation).toBeGreaterThanOrEqual(0.999);
});

test('S-02 curved Boolean output matches Canvas compositing', async ({ page }) => {
  await page.goto(baseUrl);
  const scores = await page.evaluate(async () => {
    type Point = [number, number];
    type Subpath = { start: Point; segments: Array<{ k: 'L' | 'Q' | 'C'; to: Point; c?: Point; c1?: Point; c2?: Point }>; closed: boolean };
    type Result = { operations: Record<string, { path: Subpath[] | null; diagnostics: unknown[] }>;
      left: Subpath[]; right: Subpath[]; inputsUnchanged: boolean };
    const result = await new Promise<Result>((resolve, reject) => {
      const worker = new Worker('/worker.js', { type: 'module' });
      worker.onmessage = event => { worker.terminate(); resolve(event.data); };
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ case: 'curved' });
    });
    if (!result.inputsUnchanged) throw new Error('Boolean mutated its inputs');
    const pathFor = (subpaths: Subpath[]): Path2D => {
      const path = new Path2D();
      for (const subpath of subpaths) {
        path.moveTo(...subpath.start);
        for (const segment of subpath.segments) {
          if (segment.k === 'L') path.lineTo(...segment.to);
          else if (segment.k === 'Q') path.quadraticCurveTo(...segment.c!, ...segment.to);
          else path.bezierCurveTo(...segment.c1!, ...segment.c2!, ...segment.to);
        }
        if (subpath.closed) path.closePath();
      }
      return path;
    };
    const raster = (first: Path2D, second?: Path2D, mode: GlobalCompositeOperation = 'source-over'): Uint8Array => {
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 500;
      const context = canvas.getContext('2d')!;
      context.translate(50, 50); context.scale(20, 20);
      context.fill(first);
      if (second) { context.globalCompositeOperation = mode; context.fill(second); }
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return Uint8Array.from({ length: canvas.width * canvas.height }, (_, index) => rgba[index * 4 + 3]! > 127 ? 1 : 0);
    };
    const modes: Record<string, GlobalCompositeOperation> = {
      union: 'source-over', subtract: 'destination-out', intersect: 'source-in', exclude: 'xor',
    };
    return Object.fromEntries(Object.entries(modes).map(([name, mode]) => {
      const output = result.operations[name]!;
      if (output.path === null || output.diagnostics.length) throw new Error(`Boolean failed: ${name}`);
      const expected = raster(pathFor(result.left), pathFor(result.right), mode);
      const actual = raster(pathFor(output.path));
      let intersection = 0; let union = 0;
      for (let index = 0; index < expected.length; index++) {
        if (expected[index] && actual[index]) intersection++;
        if (expected[index] || actual[index]) union++;
      }
      return [name, union === 0 ? 1 : intersection / union];
    }));
  });
  for (const [operation, iou] of Object.entries(scores)) expect(iou, operation).toBeGreaterThanOrEqual(0.999);
});
