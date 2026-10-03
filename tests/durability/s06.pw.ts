import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

let outputDir: string;
let server: Server;
let baseUrl: string;
type TestWindow = Window & { iconForgeLock?: { mode: 'writer' | 'readonly'; takeOver(): Promise<boolean>; close(): Promise<void> } };

test.beforeAll(async () => {
  outputDir = await mkdtemp(join(tmpdir(), 'iconforge-s06-'));
  await writeFile(join(outputDir, 'package.json'), '{"type":"module"}');
  await build({
    entryPoints: {
      application: resolve('packages/application/src/index.ts'),
      persistence: resolve('packages/persistence/src/index.ts'),
    },
    outdir: outputDir, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  });
  server = createServer(async (request, response) => {
    const name = request.url?.slice(1);
    if (name !== 'application.js' && name !== 'persistence.js') {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(join(outputDir, name)));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await rm(outputDir, { recursive: true, force: true });
});

test('S-06 IndexedDB append, reopen, stale writer and compaction', async ({ page }) => {
  await page.goto(baseUrl);
  const result = await page.evaluate(async () => {
    const { ProjectDispatcher } = await import(new URL('/application.js', location.origin).href);
    const { DexieProjectRepository } = await import(new URL('/persistence.js', location.origin).href);
    const id = '0198e09b-a810-7000-8000-000000000001';
    const base = { commandVersion: '1.0', projectId: id, issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' } };
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000002', type: 'project.create', payload: { id, name: 'Medical' } });
    const repository = new DexieProjectRepository('iconforge-s06');
    await repository.append(id, 0, 1, dispatcher.journal[0]);
    const first = await repository.load(id);
    const reopened = ProjectDispatcher.replay(first.snapshot, first.journal);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000003', type: 'project.rename', payload: { name: 'Clinical' }, expectedRevision: 1 });
    let staleRejected = false;
    try { await repository.append(id, 0, 2, dispatcher.journal[1]); } catch { staleRejected = true; }
    const afterRejected = await repository.load(id);
    await repository.append(id, 1, 2, dispatcher.journal[1]);
    await repository.compact(id, 2, dispatcher.project);
    const compacted = await repository.load(id);
    return { firstName: reopened.project?.name, staleRejected, revisionAfterRejected: afterRejected?.revision,
      compactedRevision: compacted?.revision, compactedName: compacted?.snapshot?.name, journalLength: compacted?.journal.length };
  });
  expect(result).toEqual({ firstName: 'Medical', staleRejected: true, revisionAfterRejected: 1,
    compactedRevision: 2, compactedName: 'Clinical', journalLength: 0 });
  await page.reload();
  const reopenedAfterReload = await page.evaluate(async () => {
    const { DexieProjectRepository } = await import(new URL('/persistence.js', location.origin).href);
    const repository = new DexieProjectRepository('iconforge-s06');
    const saved = await repository.load('0198e09b-a810-7000-8000-000000000001');
    repository.close();
    return { revision: saved?.revision, name: saved?.snapshot?.name };
  });
  expect(reopenedAfterReload).toEqual({ revision: 2, name: 'Clinical' });
});

test('S-06 second tab is read-only until explicit takeover', async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto(baseUrl);
  await second.goto(baseUrl);
  const firstMode = await first.evaluate(async () => {
    const { ProjectWriteLock } = await import(new URL('/persistence.js', location.origin).href);
    const lock = await ProjectWriteLock.open('0198e09b-a810-7000-8000-000000000001', async () => {});
    (window as TestWindow).iconForgeLock = lock;
    return lock.mode;
  });
  const secondMode = await second.evaluate(async () => {
    const { ProjectWriteLock } = await import(new URL('/persistence.js', location.origin).href);
    const lock = await ProjectWriteLock.open('0198e09b-a810-7000-8000-000000000001', async () => {});
    (window as TestWindow).iconForgeLock = lock;
    return lock.mode;
  });
  expect(firstMode).toBe('writer');
  expect(secondMode).toBe('readonly');
  const tookOver = await second.evaluate(async () => (window as TestWindow).iconForgeLock!.takeOver());
  expect(tookOver).toBe(true);
  expect(await first.evaluate(() => (window as TestWindow).iconForgeLock!.mode)).toBe('readonly');
  expect(await second.evaluate(() => (window as TestWindow).iconForgeLock!.mode)).toBe('writer');
  await second.evaluate(async () => (window as TestWindow).iconForgeLock!.close());
  await first.evaluate(async () => (window as TestWindow).iconForgeLock!.close());
  await context.close();
});

test('S-06 2,000-icon project survives snapshot, archive and browser restart', async ({ page }) => {
  await page.goto(baseUrl);
  const result = await page.evaluate(async () => {
    const { ProjectDispatcher } = await import(new URL('/application.js', location.origin).href);
    const { DexieProjectRepository, encodeProjectArchive, decodeProjectArchive } = await import(new URL('/persistence.js', location.origin).href);
    const id = '0198e09b-a810-7000-8000-000000000010';
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch({ commandVersion: '1.0', projectId: id, commandId: '0198e09b-a810-7000-8000-000000000011',
      issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' }, type: 'project.create', payload: { id, name: 'Large' } });
    const project = dispatcher.project;
    project.icons = Array.from({ length: 2_000 }, (_, index) => ({
      id: `0198e09b-a810-7000-8000-${(index + 100).toString(16).padStart(12, '0')}`,
      name: `icon-${index}`, aliases: [], tags: [], viewBox: [0, 0, 24, 24], nodes: [], variants: [],
      accessibility: { kind: 'decorative' }, provenanceIds: [],
    }));
    const repository = new DexieProjectRepository('iconforge-s06-large');
    await repository.append(id, 0, 1, dispatcher.journal[0]);
    await repository.compact(id, 1, project);
    const archive = await encodeProjectArchive(project);
    const decoded = await decodeProjectArchive(archive);
    repository.close();
    return { id, archiveBytes: archive.length, decodedIcons: decoded.project.icons.length };
  });
  expect(result.decodedIcons).toBe(2_000);
  expect(result.archiveBytes).toBeGreaterThan(1_000);
  await page.reload();
  const reopened = await page.evaluate(async id => {
    const { DexieProjectRepository } = await import(new URL('/persistence.js', location.origin).href);
    const repository = new DexieProjectRepository('iconforge-s06-large');
    const saved = await repository.load(id);
    repository.close();
    return { revision: saved?.revision, icons: saved?.snapshot?.icons.length };
  }, result.id);
  expect(reopened).toEqual({ revision: 1, icons: 2_000 });
});

test('S-06 corrupt journal tail is recovered and durably truncated', async ({ page }) => {
  await page.goto(baseUrl);
  const beforeReload = await page.evaluate(async () => {
    const { ProjectDispatcher } = await import(new URL('/application.js', location.origin).href);
    const { DexieProjectRepository } = await import(new URL('/persistence.js', location.origin).href);
    const id = '0198e09b-a810-7000-8000-000000000020';
    const base = { commandVersion: '1.0', projectId: id, issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' } };
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000021', type: 'project.create', payload: { id, name: 'Medical' } });
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000022', type: 'project.rename', payload: { name: 'Clinical' } });
    const repository = new DexieProjectRepository('iconforge-s06-recovery');
    await repository.append(id, 0, 1, dispatcher.journal[0]);
    await repository.append(id, 1, 2, { ...dispatcher.journal[1], checksum: 'corrupt' });
    const saved = await repository.load(id);
    const recovered = ProjectDispatcher.replay(saved.snapshot, saved.journal);
    await repository.truncateJournal(id, saved.revision, recovered.journal.length);
    repository.close();
    return { id, recoveredName: recovered.project?.name, diagnostics: recovered.recoveryDiagnostics.length };
  });
  expect(beforeReload.recoveredName).toBe('Medical');
  expect(beforeReload.diagnostics).toBe(1);
  await page.reload();
  const afterReload = await page.evaluate(async id => {
    const { ProjectDispatcher } = await import(new URL('/application.js', location.origin).href);
    const { DexieProjectRepository } = await import(new URL('/persistence.js', location.origin).href);
    const repository = new DexieProjectRepository('iconforge-s06-recovery');
    const saved = await repository.load(id);
    const replayed = ProjectDispatcher.replay(saved.snapshot, saved.journal);
    repository.close();
    return { revision: saved.revision, journalLength: saved.journal.length,
      name: replayed.project?.name, diagnostics: replayed.recoveryDiagnostics.length };
  }, beforeReload.id);
  expect(afterReload).toEqual({ revision: 1, journalLength: 1, name: 'Medical', diagnostics: 0 });
});

test('S-06 browser file-save adapters only report success after writing', async ({ page }) => {
  await page.goto(baseUrl);
  const result = await page.evaluate(async () => {
    const { ProjectDispatcher } = await import(new URL('/application.js', location.origin).href);
    const { saveProjectFile, decodeProjectArchive, requestPersistentStorage } = await import(new URL('/persistence.js', location.origin).href);
    const id = '0198e09b-a810-7000-8000-000000000030';
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch({ commandVersion: '1.0', projectId: id, commandId: '0198e09b-a810-7000-8000-000000000031',
      issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' }, type: 'project.create', payload: { id, name: 'Medical' } });
    let written: Uint8Array | undefined;
    let closed = false;
    const saved = await saveProjectFile(dispatcher.project, { picker: async () => ({ createWritable: async () => ({
      write: async (bytes: Uint8Array) => { written = bytes; }, close: async () => { closed = true; },
    }) }) });
    let downloaded: Uint8Array | undefined;
    const fallback = await saveProjectFile(dispatcher.project, { download: async (_name: string, bytes: Uint8Array) => { downloaded = bytes; } });
    const decoded = await decodeProjectArchive(written!);
    const durability = await requestPersistentStorage();
    return { savedMethod: saved.method, closed, name: decoded.project.name,
      fallbackMethod: fallback.method, sameBytes: downloaded?.length === written?.length, durability };
  });
  expect(result).toMatchObject({ savedMethod: 'file', closed: true, name: 'Medical',
    fallbackMethod: 'download', sameBytes: true });
  expect(['persistent', 'best-effort', 'unsupported']).toContain(result.durability);
});
