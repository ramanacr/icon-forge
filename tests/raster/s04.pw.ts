import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" fill="#123456"/></svg>';
const goldenHashes: Record<number, string> = {
  16: 'def5e557c7d91e10b89bdda63c0002d6b8305ae6282c4305ba58d356031a7204',
  20: '9d733e669ad23efb7a0803cb4a5d580c40434f16f0fe074bdf30b81eeb64a3c3',
  24: 'ca92212f894061e7feb95c93381416b55670afa128644684cd226eac957be092',
  32: '0883f9a24a3df71df545370bad139b6b454f79fd51c200705d0f31fc24a4918f',
  48: 'edb045b0f75c41ba901f38f66519247978ec41c794b492845dd343ac9678f7a5',
  64: 'c016a8797c17793b95f183cef3fe95698083863040ae2c32452e41acb4d73a42',
  128: '773c8fb4b9d2e72647c0ea9204065248d1e2eeb02985bd219fec167fc6f08b5c',
  256: 'a5b8811f4c075a96d98676ae6c6def1064c68cc70c8278031173e25c34966233',
  512: '5a370fd637fa18077f14b828943a61bf079c248e2ca29598c9a2afbf8ead00b8',
};
let outputDir: string;
let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  outputDir = await mkdtemp(join(tmpdir(), 'iconforge-s04-'));
  await writeFile(join(outputDir, 'package.json'), '{"type":"module"}');
  await build({ entryPoints: {
    worker: resolve('packages/export-raster/src/worker-spike.ts'), raster: resolve('packages/export-raster/src/index.ts'),
  }, outdir: outputDir, bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
  server = createServer(async (request, response) => {
    if (request.url === '/resvg.wasm') {
      response.writeHead(200, { 'content-type': 'application/wasm' }).end(await readFile(resolve('packages/export-raster/node_modules/@resvg/resvg-wasm/index_bg.wasm')));
      return;
    }
    if (request.url === '/worker.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(join(outputDir, 'worker.js')));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html>');
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

test('S-04 resvg worker and Node produce identical alpha-correct PNG bytes', async ({ page }) => {
  const raster = await import(pathToFileURL(join(outputDir, 'raster.js')).href);
  await raster.initializeRasterizer(await readFile(resolve('packages/export-raster/node_modules/@resvg/resvg-wasm/index_bg.wasm')));
  const sizes = Object.keys(goldenHashes).map(Number);
  const nodeOutputs = sizes.map(size => raster.renderSvgToPng(svg, size));
  expect(gzipSync(await readFile(resolve('packages/export-raster/node_modules/@resvg/resvg-wasm/index_bg.wasm')), { level: 9 }).length)
    .toBeLessThanOrEqual(1.5 * 1024 * 1024);
  await page.goto(baseUrl);
  const browser = await page.evaluate(async ({ svg, sizes }) => new Promise<any>((resolve, reject) => {
    const worker = new Worker('/worker.js', { type: 'module' });
    worker.onmessage = event => { worker.terminate(); resolve(event.data); };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage({ svg, sizes });
  }), { svg, sizes });
  expect(browser.error).toBeUndefined();
  for (const [index, item] of browser.results.entries()) {
    expect(item.size).toBe(sizes[index]);
    expect(item.cornerAlpha).toBe(0);
    expect(item.centerAlpha).toBe(255);
    const browserHash = createHash('sha256').update(Uint8Array.from(item.png)).digest('hex');
    const nodeHash = createHash('sha256').update(nodeOutputs[index].png).digest('hex');
    expect(browserHash).toBe(nodeHash);
    expect(nodeHash).toBe(goldenHashes[item.size]);
  }
  expect(browser.results.at(-1).elapsedMs).toBeLessThanOrEqual(250);
});
