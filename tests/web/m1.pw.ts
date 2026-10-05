import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { ProjectDispatcher } from '@iconforge/application';
import { compileSvgProfile } from '@iconforge/compiler-core';
import { encodeProjectArchive, type SavedProject } from '@iconforge/persistence';

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
        'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; require-trusted-types-for 'script'; trusted-types angular angular#bundler iconforge-preview" });
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
