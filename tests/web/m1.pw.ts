import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { ProjectDispatcher } from '@iconforge/application';
import { compileSpriteProfile, compileSvgProfile } from '@iconforge/compiler-core';
import { decodeProjectArchive, encodeProjectArchive, type SavedProject } from '@iconforge/persistence';

const root = resolve('dist/web/browser');
const axePath = resolve('node_modules/axe-core/axe.min.js');
let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const target = resolve(root, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
    if (!target.startsWith(`${root}/`)) { response.writeHead(404).end(); return; }
    try {
      const content = await readFile(target);
      const type = extname(target) === '.js' ? 'text/javascript' : extname(target) === '.css' ? 'text/css' : 'text/html';
      response.writeHead(200, { 'content-type': type,
        'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; require-trusted-types-for 'script'; trusted-types angular angular#bundler iconforge-preview default" });
      response.end(content);
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

test('M1 browser workflow creates, edits, undoes, exports, and reloads an icon', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await expect(page.locator('svg [data-node-id]')).toHaveCount(1);
  await page.locator('svg [data-node-id]').click();
  await page.getByRole('button', { name: 'Move right' }).click();
  await expect(page.locator('svg rect[data-node-id]')).toHaveAttribute('transform', 'matrix(1 0 0 1 1 0)');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('svg rect[data-node-id]')).not.toHaveAttribute('transform');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('svg rect[data-node-id]')).toHaveAttribute('transform', 'matrix(1 0 0 1 1 0)');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('icon-1.svg');
  const downloaded = await readFile(await download.path()!);
  expect(downloaded.toString('utf8')).toContain('matrix(1 0 0 1 1 0)');
  const saved = await page.evaluate(async () => {
    const id = localStorage.getItem('iconforge:last-project')!;
    const request = indexedDB.open('iconforge-web-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('projects', 'readonly');
    const get = transaction.objectStore('projects').get(id);
    const row = await new Promise<unknown>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return row;
  }) as SavedProject;
  const replayed = ProjectDispatcher.replay(saved.snapshot, saved.journal);
  const expected = compileSvgProfile(replayed.project!, 'web-svg').artifacts['icon-1.svg'];
  expect(downloaded.equals(Buffer.from(expected!))).toBe(true);
  await page.reload();
  await expect(page.locator('svg rect[data-node-id]')).toHaveAttribute('transform', 'matrix(1 0 0 1 1 0)');
  await expect(page.getByText('Saved in browser only')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Phase 2 browser imports an SVG file, retains its original, and rejects unsafe SVG', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  const input = page.getByLabel('Import SVG');
  await expect(input).toBeEnabled();
  const original = Buffer.from('<svg viewBox="0 0 24 24"><path d="M1 1 L4 1 L4 4 Z"/></svg>');
  await input.setInputFiles({ name: 'triangle.svg', mimeType: 'image/svg+xml', buffer: original });
  await expect(page.getByRole('button', { name: 'triangle' })).toBeVisible();
  await expect(page.locator('svg path[data-node-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'triangle' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('svg path[data-node-id]')).toHaveCount(1);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project' }).click();
  const archive = await decodeProjectArchive(await readFile((await (await downloadPromise).path())!));
  expect(archive.project.icons[0]?.name).toBe('triangle');
  expect(Object.values(archive.attachments)).toHaveLength(1);
  expect(Buffer.from(Object.values(archive.attachments)[0]!)).toEqual(original);
  await page.reload();
  await expect(page.getByRole('button', { name: 'triangle' })).toBeVisible();
  await expect(page.locator('svg path[data-node-id]')).toHaveCount(1);
  await input.setInputFiles({ name: 'arc.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg viewBox="0 0 24 24"><path d="M2 2 A4 4 0 0 1 8 8"/></svg>') });
  await expect(page.getByText('SVG arcs were converted to cubic segments')).toBeVisible();
  await input.setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg viewBox="0 0 24 24"><script/></svg>') });
  await expect(page.getByRole('alert')).toContainText('import.element-unsupported');
  await expect(page.getByRole('button', { name: 'unsafe' })).toHaveCount(0);
});

test('Phase 2 imported primitives and arc paths retain their raster silhouette', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g transform="translate(2 1)" fill="#123456">'
    + '<rect x="1" y="2" width="4" height="6" rx="1"/>'
    + '<path d="M8 4 A4 4 0 0 1 16 4 L16 10 Z"/></g></svg>';
  const input = page.getByLabel('Import SVG');
  await expect(input).toBeEnabled();
  await input.setInputFiles({ name: 'fidelity.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from(source) });
  await expect(page.getByRole('button', { name: 'fidelity' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG' }).click();
  const exported = await readFile((await (await downloadPromise).path())!, 'utf8');
  const iou = await page.evaluate(async ({ source, exported }) => {
    const pixels = async (svg: string): Promise<Uint8ClampedArray> => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 192;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0, 192, 192);
        return context.getImageData(0, 0, 192, 192).data;
      } finally { URL.revokeObjectURL(url); }
    };
    const a = await pixels(source);
    const b = await pixels(exported);
    let intersection = 0;
    let union = 0;
    for (let index = 3; index < a.length; index += 4) {
      const sourceFilled = a[index]! >= 128;
      const outputFilled = b[index]! >= 128;
      if (sourceFilled && outputFilled) intersection++;
      if (sourceFilled || outputFilled) union++;
    }
    return intersection / union;
  }, { source, exported });
  expect(iou).toBeGreaterThanOrEqual(0.995);
});

test('Phase 2 browser normalizes safe styles, named and functional paint, and px viewport', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  const input = page.getByLabel('Import SVG');
  await expect(input).toBeEnabled();
  await input.setInputFiles({ name: 'styled.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg width="24px" height="24px"><rect width="8" height="8" style="fill: red; stroke: blue; stroke-width: 1"/><circle cx="50%" cy="50%" r="12.5%" fill="hsl(120 100% 25% / 50%)" fill-opacity="0.5"/></svg>') });
  await expect(page.getByRole('button', { name: 'styled' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG' }).click();
  const exported = await readFile((await (await downloadPromise).path())!, 'utf8');
  expect(exported).toContain('viewBox="0 0 24 24"');
  expect(exported).toContain('fill="#ff0000"');
  expect(exported).toContain('stroke="#0000ff"');
  expect(exported).toContain('#00800040');
  expect(exported).toContain('cx="12" cy="12" rx="3" ry="3"');
});

test('M1 explains a missing required browser capability before enabling edits', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  });
  await page.goto(baseUrl);
  await expect(page.getByRole('alert')).toContainText('Web Locks');
  await expect(page.getByRole('button', { name: 'Create project' })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('iconforge:last-project'))).toBeNull();
});

test('M1 reports module worker startup failure without opening storage', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Worker', { value: class { constructor() { throw new Error('blocked'); } }, configurable: true });
  });
  await page.goto(baseUrl);
  await expect(page.getByRole('alert')).toContainText('module Web Workers');
  await expect(page.getByRole('button', { name: 'Create project' })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('iconforge:last-project'))).toBeNull();
});

test('M1 warns on best-effort storage and downloads a project backup', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {
      persisted: async () => false, persist: async () => false,
    } });
  });
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await expect(page.getByText('Browser storage may be cleared')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Untitled project.iconproj');
  const archive = await decodeProjectArchive(await readFile((await download.path())!));
  expect(archive.project.icons[0]?.nodes).toHaveLength(1);
  await page.reload();
  await expect(page.getByText('Browser storage may be cleared')).toBeVisible();
});

test('M1 restores a downloaded project with its original SVG and rejects damaged archives', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  const original = Buffer.from('<svg viewBox="0 0 24 24"><rect width="8" height="8"/></svg>');
  const importInput = page.getByLabel('Import SVG');
  await expect(importInput).toBeEnabled();
  await importInput.setInputFiles({ name: 'restored.svg', mimeType: 'image/svg+xml', buffer: original });
  await expect(page.getByRole('button', { name: 'restored' })).toBeVisible();
  let downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project' }).click();
  const sourceBytes = await readFile((await (await downloadPromise).path())!);
  const source = await decodeProjectArchive(sourceBytes);

  await page.getByLabel('Open project file').setInputFiles({ name: 'restore.iconproj',
    mimeType: 'application/zip', buffer: sourceBytes });
  await expect(page.getByRole('button', { name: 'restored' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Restored as a copy' })).toBeVisible();
  downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project' }).click();
  const restored = await decodeProjectArchive(await readFile((await (await downloadPromise).path())!));
  expect(restored.project.id).not.toBe(source.project.id);
  expect(restored.project.icons).toEqual(source.project.icons);
  expect(restored.attachments).toEqual(source.attachments);

  await page.getByLabel('Open project file').setInputFiles({ name: 'damaged.iconproj',
    mimeType: 'application/zip', buffer: sourceBytes.subarray(0, 20) });
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('iconforge:last-project'))).toBe(restored.project.id);
  await page.reload();
  await expect(page.getByRole('button', { name: 'restored' })).toBeVisible();
  const freshId = '0198e09b-a810-7000-8000-000000009999';
  const freshBytes = await encodeProjectArchive({ ...source.project, id: freshId }, source.attachments);
  await page.getByLabel('Open project file').setInputFiles({ name: 'fresh.iconproj',
    mimeType: 'application/zip', buffer: Buffer.from(freshBytes) });
  await expect(page.getByRole('status').filter({ hasText: 'Restored from project file' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('iconforge:last-project'))).toBe(freshId);
});

test('M2 browser downloads a sprite archive matching the pure compiler', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('button', { name: 'Add icon' })).toBeEnabled();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  const projectDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project' }).click();
  const project = (await decodeProjectArchive(await readFile((await (await projectDownload).path())!))).project;
  const expected = compileSpriteProfile(project, 'web-sprite');
  const spriteDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download sprite' }).click();
  const archive = unzipSync(await readFile((await (await spriteDownload).path())!));
  expect(Object.keys(archive).sort()).toEqual(['manifest.json', 'sprite.svg', 'usage.html']);
  expect(archive['sprite.svg']).toEqual(expected.artifacts['sprite.svg']);
  expect(archive['usage.html']).toEqual(expected.artifacts['usage.html']);
  expect(archive['manifest.json']).toEqual(expected.manifestBytes);
});

test('S-06 idle compaction keeps undo available after reload', async ({ page }) => {
  await page.clock.install();
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await page.locator('svg rect[data-node-id]').click(); // An identity gesture must keep idle compaction scheduled.
  await page.clock.fastForward(31_000);
  await expect.poll(() => page.evaluate(async () => {
    const id = localStorage.getItem('iconforge:last-project')!;
    const request = indexedDB.open('iconforge-web-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
    const row = await new Promise<{ journal: unknown[]; checkpoint?: unknown }>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return { journalLength: row.journal.length, checkpoint: Boolean(row.checkpoint) };
  })).toEqual({ journalLength: 0, checkpoint: true });
  await page.reload();
  await expect(page.locator('svg rect[data-node-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('svg rect[data-node-id]')).toHaveCount(0);
});

test('M1 primitive tools and snapped pointer drag commit one reversible edit', async ({ page }) => {
  test.setTimeout(15_000);
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add ellipse' }).click();
  await page.getByRole('button', { name: 'Add line' }).click();
  await expect(page.locator('svg ellipse[data-node-id]')).toHaveCount(1);
  await expect(page.locator('svg line[data-node-id]')).toHaveCount(1);
  const ellipse = page.locator('svg ellipse[data-node-id]');
  const shape = await ellipse.boundingBox();
  const svg = await page.locator('.canvas svg').boundingBox();
  expect(shape && svg).toBeTruthy();
  const startX = shape!.x + shape!.width / 2;
  const startY = shape!.y + shape!.height / 4;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + svg!.width * 4.2 / 24, startY + svg!.height * 3.2 / 24, { steps: 4 });
  await expect(ellipse).toHaveAttribute('transform', 'matrix(1 0 0 1 4 3)');
  await page.mouse.up();
  await expect(ellipse).toHaveAttribute('transform', 'matrix(1 0 0 1 4 3)');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(ellipse).not.toHaveAttribute('transform');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(ellipse).toHaveAttribute('transform', 'matrix(1 0 0 1 4 3)');
});

test('M1 drag feedback keeps a 225-shape scene stable', async ({ page }, testInfo) => {
  const dispatcher = new ProjectDispatcher();
  const id = '0198e09b-a810-7000-8000-00000000a001';
  const iconId = '0198e09b-a810-7000-8000-00000000a002';
  const base = { commandVersion: '1.0' as const, projectId: id,
    issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' as const } };
  dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-00000000a003',
    type: 'project.create', payload: { id, name: 'Drag scene' } });
  const nodes = Array.from({ length: 225 }, (_, index) => ({
    id: `0198e09b-a810-7000-8000-${(0xa100 + index).toString(16).padStart(12, '0')}`,
    type: 'rect' as const, visible: true, locked: false,
    x: (index % 15) * 1.5, y: Math.floor(index / 15) * 1.5,
    width: 1, height: 1, rx: 0, ry: 0, fill: { kind: 'token' as const, token: 'currentColor' },
  }));
  dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-00000000a004',
    type: 'icon.add', payload: { icon: { id: iconId, name: 'grid', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], variants: [], provenanceIds: [],
      accessibility: { kind: 'decorative' }, nodes } } });
  await page.goto(baseUrl);
  await page.evaluate(({ id, project }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('iconforge-web-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('projects', 'readwrite');
      transaction.objectStore('projects').put({ id, revision: project.revision, snapshot: project, journal: [] });
      transaction.oncomplete = () => { localStorage.setItem('iconforge:last-project', id); db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), { id, project: dispatcher.project! });
  await page.reload();
  const first = page.locator('svg [data-node-id]').first();
  await expect(page.locator('svg [data-node-id]')).toHaveCount(225);
  const bounds = await first.boundingBox();
  const svgBounds = await page.locator('.canvas svg').boundingBox();
  expect(bounds && svgBounds).toBeTruthy();
  expect(bounds!.y).toBeLessThan(page.viewportSize()!.height);
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.evaluate(() => { (window as typeof window & { dragSvg?: SVGSVGElement }).dragSvg = document.querySelector('.canvas svg')!; });
  await page.mouse.move(bounds!.x + bounds!.width / 2 + svgBounds!.width * 2.2 / 24,
    bounds!.y + bounds!.height / 2 + svgBounds!.height * 1.2 / 24, { steps: 20 });
  const feedback = await page.evaluate(() => ({
    stable: document.querySelector('.canvas svg') === (window as typeof window & { dragSvg?: SVGSVGElement }).dragSvg,
    samples: performance.getEntriesByName('iconforge.transform-feedback', 'measure').map(entry => entry.duration),
  }));
  expect(feedback.stable).toBe(true);
  expect(feedback.samples.length).toBeGreaterThanOrEqual(10);
  const p95 = feedback.samples.sort((a, b) => a - b)[Math.ceil(feedback.samples.length * 0.95) - 1]!;
  if (testInfo.project.name === 'chromium') expect(p95).toBeLessThanOrEqual(16.67 * 1.1);
  await expect(first).toHaveAttribute('transform', 'matrix(1 0 0 1 2 1)');
  await page.mouse.up();
  await expect(first).toHaveAttribute('transform', 'matrix(1 0 0 1 2 1)');
});

test('M1 second tab can take over a read-only project', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  const viewer = await page.context().newPage();
  await viewer.goto(baseUrl);
  await expect(viewer.getByText('Read only in this tab')).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Add rectangle' })).toBeDisabled();
  await viewer.getByRole('button', { name: 'Take over editing' }).click();
  await expect(viewer.getByText('Saved in browser only')).toBeVisible();
  await viewer.getByRole('button', { name: 'Add rectangle' }).click();
  await expect(viewer.locator('svg rect[data-node-id]')).toHaveCount(1);
  await page.bringToFront();
  await expect(page.getByText('Read only in this tab')).toBeVisible();
  await viewer.close();
});

test('M1 damaged journal tail offers explicit recovery of valid edits', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await page.evaluate(async () => {
    const id = localStorage.getItem('iconforge:last-project')!;
    const request = indexedDB.open('iconforge-web-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('projects', 'readwrite');
    const store = transaction.objectStore('projects');
    const get = store.get(id);
    const row = await new Promise<{ revision: number; journal: { checksum: string }[] }>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    row.journal.push({ ...row.journal.at(-1)!, checksum: '0'.repeat(64) });
    row.revision++;
    store.put(row);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByText('Recovery needed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add rectangle' })).toBeDisabled();
  await page.getByRole('button', { name: 'Recover valid edits' }).click();
  await expect(page.locator('svg rect[data-node-id]')).toHaveCount(1);
  await expect(page.getByText('Recovered valid edits')).toBeVisible();
  await page.reload();
  await expect(page.locator('svg rect[data-node-id]')).toHaveCount(1);
  await expect(page.getByText('Saved in browser only')).toBeVisible();
});

test('M1 damaged checkpoint opens valid post-snapshot edits and recovers a separate copy', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  const sourceId = await page.evaluate(() => localStorage.getItem('iconforge:last-project')!);
  const initial = await page.evaluate(async id => {
    const request = indexedDB.open('iconforge-web-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const row = await new Promise<SavedProject>((resolve, reject) => {
      const get = db.transaction('projects').objectStore('projects').get(id);
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return row;
  }, sourceId);
  const dispatcher = ProjectDispatcher.replay(initial.snapshot, initial.journal);
  await page.evaluate(async ({ id, snapshot, checkpoint }) => {
    const request = indexedDB.open('iconforge-web-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put({ id, revision: snapshot.revision, snapshot, journal: [], checkpoint });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, { id: sourceId, snapshot: dispatcher.project!, checkpoint: dispatcher.checkpoint() });
  await page.reload();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await page.evaluate(async id => {
    const request = indexedDB.open('iconforge-web-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('projects', 'readwrite');
    const store = transaction.objectStore('projects');
    const row = await new Promise<SavedProject>((resolve, reject) => {
      const get = store.get(id);
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    row.checkpoint!.checksum = '0'.repeat(64);
    store.put(row);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, sourceId);
  await page.reload();
  await expect(page.getByText('Recovery needed')).toBeVisible();
  await expect(page.locator('svg rect[data-node-id]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add rectangle' })).toBeDisabled();
  const rawDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recovery data' }).click();
  const raw = JSON.parse(await readFile((await (await rawDownload).path())!, 'utf8')) as SavedProject;
  expect(raw.id).toBe(sourceId);
  expect(raw.checkpoint?.checksum).toBe('0'.repeat(64));
  expect(raw.journal).toHaveLength(1);
  await page.getByRole('button', { name: 'Recover as copy' }).click();
  await expect(page.getByText('Recovered as a copy')).toBeVisible();
  const recoveredId = await page.evaluate(() => localStorage.getItem('iconforge:last-project')!);
  expect(recoveredId).not.toBe(sourceId);
  await expect(page.locator('svg rect[data-node-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await expect(page.locator('svg rect[data-node-id]')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('svg rect[data-node-id]')).toHaveCount(2);
  const original = await page.evaluate(async id => {
    const request = indexedDB.open('iconforge-web-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const row = await new Promise<SavedProject>((resolve, reject) => {
      const get = db.transaction('projects').objectStore('projects').get(id);
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return row;
  }, sourceId);
  expect(original.checkpoint?.checksum).toBe('0'.repeat(64));
  expect(original.journal).toHaveLength(1);
});

test('M1 grid and safe-area guides are editor-only overlays', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await expect(page.locator('svg [data-editor-grid] line')).toHaveCount(50);
  await expect(page.locator('svg [data-safe-area]')).toHaveAttribute('x', '2');
  await page.getByRole('button', { name: 'Hide grid' }).click();
  await expect(page.locator('svg [data-editor-grid]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show grid' }).click();
  await expect(page.locator('svg [data-editor-grid] line')).toHaveCount(50);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG' }).click();
  const download = await downloadPromise;
  const exported = await readFile(await download.path()!, 'utf8');
  expect(exported).not.toContain('data-editor-grid');
  expect(exported).not.toContain('data-safe-area');
});

test('M1 layer selection groups and ungroups shapes with undo and redo', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await page.getByRole('button', { name: 'Add ellipse' }).click();
  await page.getByRole('button', { name: 'Rectangle layer' }).click();
  await page.getByRole('button', { name: 'Ellipse layer' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group selection', exact: true }).click();
  await expect(page.locator('svg g[data-node-id]')).toHaveCount(1);
  await expect(page.locator('svg g[data-node-id] [data-node-id]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('svg g[data-node-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('svg g[data-node-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Group layer' }).click();
  await page.getByRole('button', { name: 'Ungroup selection' }).click();
  await expect(page.locator('svg g[data-node-id]')).toHaveCount(0);
  await expect(page.locator('svg [data-node-id]')).toHaveCount(2);
});

test('M1 selected layers delete as one reversible saved command', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await page.getByRole('button', { name: 'Add ellipse' }).click();
  await page.getByRole('button', { name: 'Rectangle layer' }).click();
  await page.getByRole('button', { name: 'Ellipse layer' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Delete selection' }).click();
  await expect(page.locator('svg [data-node-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('svg [data-node-id]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('svg [data-node-id]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('svg [data-node-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('svg [data-node-id]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Rectangle layer' }).focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('svg [data-node-id]')).toHaveCount(1);
});

test('M1 shape appearance edits are reversible and exported', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await page.getByRole('button', { name: 'Rectangle layer' }).click();
  await page.getByRole('button', { name: 'Outline shape' }).click();
  const rect = page.locator('svg rect[data-node-id]');
  await expect(rect).toHaveAttribute('fill', 'none');
  await expect(rect).toHaveAttribute('stroke', 'currentColor');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(rect).toHaveAttribute('fill', 'currentColor');
  await expect(rect).not.toHaveAttribute('stroke');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(rect).toHaveAttribute('fill', 'none');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG' }).click();
  const download = await downloadPromise;
  expect(await readFile(await download.path()!, 'utf8')).toContain('stroke="currentColor"');
});

test('M1 keyboard layer controls move a shape through journalled commands', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  const layer = page.getByRole('button', { name: 'Rectangle layer' });
  await layer.focus();
  await layer.press('ArrowRight');
  await expect(page.locator('svg rect[data-node-id]')).toHaveAttribute('transform', 'matrix(1 0 0 1 1 0)');
  await layer.press('ArrowUp');
  await expect(page.locator('svg rect[data-node-id]')).toHaveAttribute('transform', 'matrix(1 0 0 1 1 -1)');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('svg rect[data-node-id]')).toHaveAttribute('transform', 'matrix(1 0 0 1 1 0)');
});

test('M1 numeric inspector applies a precise reversible position', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await page.getByRole('button', { name: 'Rectangle layer' }).click();
  await page.getByRole('spinbutton', { name: 'X position' }).fill('3.5');
  await page.getByRole('spinbutton', { name: 'Y position' }).fill('-2.25');
  await page.getByRole('button', { name: 'Apply position' }).click();
  await expect(page.locator('svg rect[data-node-id]')).toHaveAttribute('transform', 'matrix(1 0 0 1 3.5 -2.25)');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('svg rect[data-node-id]')).not.toHaveAttribute('transform');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('svg rect[data-node-id]')).toHaveAttribute('transform', 'matrix(1 0 0 1 3.5 -2.25)');
});

test('M1 inspector color and stroke width changes survive export and reload', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await page.getByRole('button', { name: 'Rectangle layer' }).click();
  await page.getByLabel('Fill color').fill('#cc3344');
  await page.getByRole('button', { name: 'Apply fill color' }).click();
  const rect = page.locator('svg rect[data-node-id]');
  await expect(rect).toHaveAttribute('fill', '#cc3344');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG' }).click();
  const download = await downloadPromise;
  expect(await readFile(await download.path()!, 'utf8')).toContain('#cc3344');
  await page.getByRole('button', { name: 'Outline shape' }).click();
  await page.getByRole('spinbutton', { name: 'Stroke width' }).fill('2.5');
  await page.getByRole('button', { name: 'Apply stroke width' }).click();
  await expect(rect).toHaveAttribute('stroke-width', '2.5');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(rect).toHaveAttribute('stroke-width', '1.75');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(rect).toHaveAttribute('stroke-width', '2.5');
  await page.reload();
  await expect(rect).toHaveAttribute('stroke-width', '2.5');
});

test('M1 repeated shapes have distinct keyboard-accessible layer names', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  const first = page.getByRole('button', { name: 'Rectangle 1 layer' });
  const second = page.getByRole('button', { name: 'Rectangle 2 layer' });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await second.focus();
  await second.press('ArrowRight');
  await expect(page.locator('svg rect[data-node-id]').nth(0)).not.toHaveAttribute('transform');
  await expect(page.locator('svg rect[data-node-id]').nth(1)).toHaveAttribute('transform', 'matrix(1 0 0 1 1 0)');
});

test('M1 composite browser icon exports byte-identically through the CLI', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await page.getByRole('button', { name: 'Add ellipse' }).click();
  await page.getByRole('button', { name: 'Add line' }).click();
  await page.getByRole('button', { name: 'Rectangle layer' }).click();
  await page.getByLabel('Fill color').fill('#336699');
  await page.getByRole('button', { name: 'Apply fill color' }).click();
  await page.getByRole('button', { name: 'Ellipse layer' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group selection', exact: true }).click();
  await page.getByRole('button', { name: 'Move right' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG' }).click();
  const download = await downloadPromise;
  const browserSvg = await readFile((await download.path())!);
  const saved = await page.evaluate(async () => {
    const id = localStorage.getItem('iconforge:last-project')!;
    const request = indexedDB.open('iconforge-web-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
    const row = await new Promise<unknown>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return row;
  }) as SavedProject;
  const project = ProjectDispatcher.replay(saved.snapshot, saved.journal).project!;
  const dir = await mkdtemp(join(tmpdir(), 'iconforge-m1-cli-'));
  try {
    const archivePath = join(dir, 'project.iconproj');
    const out = join(dir, 'out');
    await writeFile(archivePath, await encodeProjectArchive(project));
    execFileSync(process.execPath, ['apps/cli/dist/iconforge.mjs', 'compile', archivePath,
      '--profile', 'web-svg', '--out', out], { cwd: process.cwd() });
    expect(await readFile(join(out, 'icon-1.svg'))).toEqual(browserSvg);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('M1 three-icon project keeps edits and browser CLI parity across reload', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await page.getByRole('button', { name: 'Rectangle layer' }).click();
  await page.getByRole('button', { name: 'Move right' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add ellipse' }).click();
  await page.getByRole('button', { name: 'Ellipse layer' }).click();
  await page.getByRole('button', { name: 'Outline shape' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add line' }).click();
  await page.getByRole('button', { name: 'Line layer' }).click();
  await page.getByRole('button', { name: 'Move right' }).click();
  await page.getByRole('button', { name: 'icon-1' }).click();
  await expect(page.locator('svg rect[data-node-id]')).toHaveAttribute('transform', 'matrix(1 0 0 1 1 0)');
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'icon-3' }).click();
  await expect(page.locator('svg line[data-node-id]')).not.toHaveAttribute('transform');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('svg line[data-node-id]')).toHaveAttribute('transform', 'matrix(1 0 0 1 1 0)');
  await page.reload();
  const browserSvgs = new Map<string, Buffer>();
  for (const name of ['icon-1', 'icon-2', 'icon-3']) {
    await page.getByRole('button', { name }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export SVG' }).click();
    browserSvgs.set(`${name}.svg`, await readFile((await (await downloadPromise).path())!));
  }
  const saved = await page.evaluate(async () => {
    const id = localStorage.getItem('iconforge:last-project')!;
    const request = indexedDB.open('iconforge-web-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
    const row = await new Promise<unknown>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return row;
  }) as SavedProject;
  const project = ProjectDispatcher.replay(saved.snapshot, saved.journal).project!;
  const dir = await mkdtemp(join(tmpdir(), 'iconforge-m1-multi-'));
  try {
    const archivePath = join(dir, 'project.iconproj');
    const out = join(dir, 'out');
    await writeFile(archivePath, await encodeProjectArchive(project));
    execFileSync(process.execPath, ['apps/cli/dist/iconforge.mjs', 'compile', archivePath,
      '--profile', 'web-svg', '--out', out], { cwd: process.cwd() });
    for (const [name, browserSvg] of browserSvgs) expect(await readFile(join(out, name))).toEqual(browserSvg);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('M1 editor passes automated WCAG 2.2 AA checks', async ({ page }) => {
  await page.addInitScript({ path: axePath });
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(context: Document, options: unknown): Promise<{
      violations: { id: string; nodes: { target: string[] }[] }[] }>; } }).axe;
    const results = await axe.run(document, { runOnly: { type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return results.violations.map(violation => ({ id: violation.id,
      targets: violation.nodes.map(node => node.target.join(' ')) }));
  });
  expect(violations).toEqual([]);
});

test('M1 phone preview controls meet the 44 pixel target minimum', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 900, height: 844 }, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto(baseUrl);
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByRole('button', { name: 'Add icon' }).click();
    await page.getByRole('button', { name: 'Add rectangle' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText('Mobile preview only')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add rectangle' })).toBeDisabled();
    await expect(page.locator('svg rect[data-node-id]')).toHaveCount(1);
    const controls = page.locator('button:visible');
    for (let index = 0; index < await controls.count(); index++) {
      const rect = await controls.nth(index).boundingBox();
      expect(rect?.height).toBeGreaterThanOrEqual(44);
      expect(rect?.width).toBeGreaterThanOrEqual(44);
    }
  } finally { await context.close(); }
});
