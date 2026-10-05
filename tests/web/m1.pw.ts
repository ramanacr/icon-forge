import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const root = resolve('dist/web/browser');
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
  expect(await readFile(await download.path()!, 'utf8')).toContain('matrix(1 0 0 1 1 0)');
  await page.reload();
  await expect(page.locator('svg rect[data-node-id]')).toHaveAttribute('transform', 'matrix(1 0 0 1 1 0)');
  await expect(page.getByText('Saved in browser only')).toBeVisible();
  expect(errors).toEqual([]);
});
