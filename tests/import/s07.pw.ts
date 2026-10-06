import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

let outputDir: string;
let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  outputDir = await mkdtemp(join(tmpdir(), 'iconforge-s07-'));
  await Promise.all([
    build({ entryPoints: [resolve('packages/import-svg/src/worker.ts')], outfile: join(outputDir, 'worker.js'),
      bundle: true, format: 'esm', platform: 'browser', target: 'es2022' }),
    build({ entryPoints: [resolve('packages/import-svg/src/browser.ts')], outfile: join(outputDir, 'browser.js'),
      bundle: true, format: 'esm', platform: 'browser', target: 'es2022' }),
  ]);
  server = createServer(async (request, response) => {
    if (request.url !== '/worker.js' && request.url !== '/browser.js') {
      response.writeHead(200, { 'content-type': 'text/html',
        'content-security-policy': "default-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'" }).end('<!doctype html>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/javascript' })
      .end(await readFile(join(outputDir, request.url.slice(1))));
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

test('S-07 worker parses safe SVG under CSP and rejects malicious inputs', async ({ page }) => {
  await page.goto(baseUrl);
  const result = await page.evaluate(async () => {
    const url = '/browser.js';
    const { parseSvgInWorker } = await import(url) as {
      parseSvgInWorker(source: string, options?: { limits?: { elements: number } }): Promise<{ name: string; children: unknown[] }> };
    const safe = await parseSvgInWorker('<svg><rect width="4" height="4"/></svg>');
    const malicious = [
      '<!DOCTYPE svg [<!ENTITY x "boom">]><svg/>',
      '<svg><script/></svg>',
      '<svg onload="alert(1)"/>',
      '<svg><use href="https://example.com/a.svg#x"/></svg>',
      '<svg><defs><g id="a"><use href="#a"/></g></defs><use href="#a"/></svg>',
    ];
    const errors = [];
    for (const source of malicious) {
      try { await parseSvgInWorker(source); errors.push('accepted'); }
      catch (error) { errors.push((error as Error).message); }
    }
    try { await parseSvgInWorker('<svg><rect/></svg>', { limits: { elements: 1 } }); errors.push('accepted'); }
    catch (error) { errors.push((error as Error).message); }
    return { safe, errors };
  });
  expect(result.safe).toMatchObject({ name: 'svg', children: [{ name: 'rect' }] });
  expect(result.errors).toEqual(['import.doctype', 'import.element-unsupported', 'import.attribute-unsupported',
    'import.reference-invalid', 'import.use-cycle', 'import.element-limit']);
});

test('S-07 browser wrapper terminates a worker that never replies', async ({ page }) => {
  await page.goto(baseUrl);
  const result = await page.evaluate(async () => {
    const url = '/browser.js';
    const { parseSvgInWorker } = await import(url) as {
      parseSvgInWorker(source: string, options?: { timeoutMs?: number }): Promise<unknown> };
    const RealWorker = window.Worker;
    let terminated = 0;
    class HangingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage(): void {}
      terminate(): void { terminated++; }
    }
    window.Worker = HangingWorker as unknown as typeof Worker;
    try {
      let error = '';
      try { await parseSvgInWorker('<svg/>', { timeoutMs: 20 }); }
      catch (reason) { error = (reason as Error).message; }
      return { error, terminated };
    } finally { window.Worker = RealWorker; }
  });
  expect(result).toEqual({ error: 'import.timeout', terminated: 1 });
});

test('S-07 parses near-limit 2 MB SVG sources within 300 ms in the worker', async ({ page }) => {
  await page.goto(baseUrl);
  const results = await page.evaluate(async () => {
    const sources = [
      `<svg><!--${'x'.repeat(2 * 1024 * 1024 - 100)}--><rect width="1"/></svg>`,
      `<svg>${`<path d="${'M0 0 '.repeat(33_000)}"/>`.repeat(12)}</svg>`,
    ];
    const results = [];
    for (const source of sources) {
      results.push(await new Promise<{ ok: boolean; parseMs: number; ast: { name: string } }>((resolve, reject) => {
        const worker = new Worker('/worker.js', { type: 'module' });
        worker.onmessage = event => { worker.terminate(); resolve(event.data); };
        worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
        worker.postMessage({ source });
      }));
    }
    return results;
  });
  for (const [index, result] of results.entries()) {
    expect(result.ok).toBe(true);
    expect(result.ast.name).toBe('svg');
    console.info(`S-07 near-limit SVG parse ${index + 1}: ${result.parseMs.toFixed(1)} ms`);
    expect(result.parseMs).toBeLessThanOrEqual(300);
  }
});
