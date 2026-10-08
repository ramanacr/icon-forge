import { createServer, type Server } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { defaultDesignSystem, type ProjectCommand } from '@iconforge/commands';
import type { ProjectV1 } from '@iconforge/project-model';

const root = resolve('dist/web/browser');
const id = (part: number): string => `0198e09b-a810-7000-8000-${part.toString(16).padStart(12, '0')}`;
let server: Server;
let baseUrl: string;
let workerFile: string;

test.beforeAll(async () => {
  const files = (await readdir(root)).filter(file => /^worker-.*\.js$/.test(file));
  const matches = await Promise.all(files.map(async file => ({ file,
    source: await readFile(join(root, file), 'utf8') })));
  workerFile = matches.find(item => item.source.includes('batch.preview.invalid-command'))?.file ?? '';
  if (!workerFile) throw new Error('Batch preview worker is missing from the production build');
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!path.startsWith(`${root}/`)) { response.writeHead(404).end(); return; }
    try {
      const body = await readFile(path);
      response.writeHead(200, { 'content-type': extname(path) === '.js' ? 'text/javascript' : 'text/html',
        'content-security-policy': "default-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'" });
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
});

test('Phase 4 100-icon batch dry-run stays within the worker compute budget', async ({ page }) => {
  const project: ProjectV1 = { schemaVersion: '1.0', id: id(1), name: 'Batch', revision: 1,
    designSystem: defaultDesignSystem(), tokens: [], components: [], exportProfiles: [], provenance: [],
    icons: Array.from({ length: 100 }, (_, index) => ({ id: id(index + 2), name: `icon-${index}`,
      aliases: [], tags: [], viewBox: [0, 0, 24, 24] as [number, number, number, number],
      accessibility: { kind: 'decorative' as const }, provenanceIds: [], variants: [],
      nodes: [{ id: id(index + 200), type: 'line' as const, visible: true, locked: false,
        x1: 4, y1: 4, x2: 20, y2: 20, stroke: { paint: { kind: 'color' as const, value: '#123456' },
          width: 2.5, cap: 'square' as const, join: 'bevel' as const, miterLimit: 4 } }] })) };
  const command: ProjectCommand = { commandVersion: '1.0', commandId: id(500), projectId: project.id,
    issuedAt: '2026-10-08T00:00:00Z', actor: { kind: 'user' }, expectedRevision: project.revision,
    dryRun: true, type: 'set.applyStyle', payload: { iconIds: project.icons.map(icon => icon.id),
      changes: [{ op: 'setStrokePolicy' }] } };
  await page.goto(baseUrl);
  const samples: number[] = [];
  for (let index = 0; index < 3; index++) {
    const reply = await page.evaluate(({ project, command, workerFile }) => new Promise<{
      ok: boolean; patches?: unknown[]; icons?: { beforeSvg: string; afterSvg: string }[];
      computeMs?: number; error?: string;
    }>((resolve, reject) => {
      const worker = new Worker(`/${workerFile}`, { type: 'module' });
      worker.onmessage = event => { worker.terminate(); resolve(event.data); };
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ project, command });
    }), { project, command, workerFile });
    expect(reply.error).toBeUndefined();
    expect(reply.patches).toHaveLength(100);
    expect(reply.icons).toHaveLength(100);
    expect(reply.icons![0]!.beforeSvg).toContain('stroke-width="2.5"');
    expect(reply.icons![0]!.afterSvg).toContain('stroke-width="1.75"');
    samples.push(reply.computeMs!);
  }
  expect(samples.sort((a, b) => a - b)[2]).toBeLessThanOrEqual(500);
});
