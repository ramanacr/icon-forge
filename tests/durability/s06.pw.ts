import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';
import { decodeProjectArchive } from '../../packages/persistence/src/project-archive.js';

let outputDir: string;
let server: Server;
let baseUrl: string;
type TestWindow = Window & { iconForgeLock?: { mode: 'writer' | 'readonly'; takeOver(): Promise<boolean>; close(): Promise<void>;
  publishRevision(revision: number): void; onRevision(callback: (revision: number) => void): () => void };
  iconForgeRevisions?: number[] };

test.beforeAll(async () => {
  outputDir = await mkdtemp(join(tmpdir(), 'iconforge-s06-'));
  await writeFile(join(outputDir, 'package.json'), '{"type":"module"}');
  await build({
    entryPoints: {
      application: resolve('packages/application/src/index.ts'),
      persistence: resolve('packages/persistence/src/index.ts'),
      workspace: resolve('apps/web/src/workspace.ts'),
    },
    outdir: outputDir, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  });
  server = createServer(async (request, response) => {
    const name = request.url?.slice(1);
    if (name !== 'application.js' && name !== 'persistence.js' && name !== 'workspace.js') {
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

test('S-06 browser workspace compacts at 200 commands and keeps undo', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(baseUrl);
  const result = await page.evaluate(async () => {
    const { BrowserWorkspace } = await import(new URL('/workspace.js', location.origin).href);
    const { DexieProjectRepository } = await import(new URL('/persistence.js', location.origin).href);
    const workspace = new BrowserWorkspace();
    await workspace.create();
    await workspace.addIcon();
    for (let index = 0; index < 197; index++) await workspace.addRectangle();
    const id = workspace.project!.id;
    const repository = new DexieProjectRepository('iconforge-web-v1');
    const saved = await repository.load(id);
    await workspace.close();
    const reopened = new BrowserWorkspace();
    await reopened.openLast();
    await reopened.undo();
    const afterUndo = reopened.icon?.nodes.length;
    await reopened.close();
    repository.close();
    return { revision: saved?.revision, journalLength: saved?.journal.length,
      checkpoint: Boolean(saved?.checkpoint), snapshotNodes: saved?.snapshot?.icons[0]?.nodes.length, afterUndo };
  });
  expect(result).toEqual({ revision: 200, journalLength: 0,
    checkpoint: true, snapshotNodes: 197, afterUndo: 196 });
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
    let damagedCheckpointRejected = false;
    try { await repository.compact(id, 2, dispatcher.project,
      { ...dispatcher.checkpoint(), checksum: '0'.repeat(64) }); }
    catch { damagedCheckpointRejected = true; }
    const beforeCompaction = await repository.load(id);
    await repository.compact(id, 2, dispatcher.project, dispatcher.checkpoint());
    const compacted = await repository.load(id);
    const restored = ProjectDispatcher.replay(compacted.snapshot, compacted.journal, compacted.checkpoint);
    restored.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000004', type: 'history.undo', payload: {} });
    return { firstName: reopened.project?.name, staleRejected, revisionAfterRejected: afterRejected?.revision,
      damagedCheckpointRejected, journalBeforeCompaction: beforeCompaction?.journal.length,
      compactedRevision: compacted?.revision, compactedName: compacted?.snapshot?.name,
      journalLength: compacted?.journal.length, undoName: restored.project?.name };
  });
  expect(result).toEqual({ firstName: 'Medical', staleRejected: true, revisionAfterRejected: 1,
    damagedCheckpointRejected: true, journalBeforeCompaction: 2,
    compactedRevision: 2, compactedName: 'Clinical', journalLength: 0, undoName: 'Medical' });
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

test('S-06 SVG original and import journal commit atomically', async ({ page }) => {
  await page.goto(baseUrl);
  const result = await page.evaluate(async () => {
    const { ProjectDispatcher } = await import(new URL('/application.js', location.origin).href);
    const { DexieProjectRepository, encodeProjectArchive, decodeProjectArchive } =
      await import(new URL('/persistence.js', location.origin).href);
    const id = '0198e09b-a810-7000-8000-000000000201';
    const base = { commandVersion: '1.0', projectId: id, issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' } };
    const dispatcher = new ProjectDispatcher();
    const repository = new DexieProjectRepository('iconforge-s06-import');
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000202',
      type: 'project.create', payload: { id, name: 'Imported' } });
    await repository.append(id, 0, 1, dispatcher.journal[0]);
    const original = new TextEncoder().encode('<svg viewBox="0 0 24 24"/>');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', original)),
      byte => byte.toString(16).padStart(2, '0')).join('');
    const provenance = { id: '0198e09b-a810-7000-8000-000000000203', originalSha256: hash, modified: false };
    const icon = { id: '0198e09b-a810-7000-8000-000000000204', name: 'imported', aliases: [], tags: [],
      viewBox: [0, 0, 24, 24], nodes: [], variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [provenance.id] };
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000205',
      type: 'icon.importSvg', payload: { icon, provenance, diagnostics: [] } });
    let hashRejected = false;
    try { await repository.appendImport(id, 1, 2, dispatcher.journal[1], new TextEncoder().encode('<svg/>')); }
    catch { hashRejected = true; }
    const before = await repository.load(id);
    const originalsBefore = await repository.loadOriginals(id);
    await repository.appendImport(id, 1, 2, dispatcher.journal[1], original);
    const attachments = await repository.loadOriginals(id);
    const saved = await repository.load(id);
    const reopened = ProjectDispatcher.replay(saved.snapshot, saved.journal);
    const archive = await decodeProjectArchive(await encodeProjectArchive(reopened.project, attachments));
    let staleRejected = false;
    try { await repository.appendImport(id, 1, 2, dispatcher.journal[1], original); }
    catch { staleRejected = true; }
    repository.close();
    return { hashRejected, beforeRevision: before?.revision, originalCountBefore: Object.keys(originalsBefore).length,
      revision: saved?.revision, iconCount: reopened.project?.icons.length,
      attachmentMatches: new TextDecoder().decode(archive.attachments[`originals/${hash}.svg`]) ===
        new TextDecoder().decode(original), staleRejected };
  });
  expect(result).toEqual({ hashRejected: true, beforeRevision: 1, originalCountBefore: 0,
    revision: 2, iconCount: 1, attachmentMatches: true, staleRejected: true });
});

test('S-06 IndexedDB v1 rows survive the originals-table upgrade', async ({ page }) => {
  await page.goto(baseUrl);
  const result = await page.evaluate(async () => {
    const databaseName = 'iconforge-s06-upgrade';
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('projects', 'readwrite');
        transaction.objectStore('projects').put({ id: 'prior', revision: 0, snapshot: null, journal: [] });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const { DexieProjectRepository } = await import(new URL('/persistence.js', location.origin).href);
    const repository = new DexieProjectRepository(databaseName);
    const row = await repository.load('prior');
    const originals = await repository.loadOriginals('prior');
    repository.close();
    return { revision: row?.revision, originals: Object.keys(originals).length };
  });
  expect(result).toEqual({ revision: 0, originals: 0 });
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

test('S-06 read-only viewers receive committed revision announcements', async ({ browser }) => {
  const context = await browser.newContext();
  const writer = await context.newPage();
  const viewer = await context.newPage();
  await writer.goto(baseUrl);
  await viewer.goto(baseUrl);
  await writer.evaluate(async () => {
    const { ProjectWriteLock } = await import(new URL('/persistence.js', location.origin).href);
    (window as TestWindow).iconForgeLock = await ProjectWriteLock.open('0198e09b-a810-7000-8000-000000000070', async () => {});
  });
  await viewer.evaluate(async () => {
    const { ProjectWriteLock } = await import(new URL('/persistence.js', location.origin).href);
    const lock = await ProjectWriteLock.open('0198e09b-a810-7000-8000-000000000070', async () => {});
    (window as TestWindow).iconForgeLock = lock;
    (window as TestWindow).iconForgeRevisions = [];
    lock.onRevision((revision: number) => (window as TestWindow).iconForgeRevisions!.push(revision));
  });
  await writer.evaluate(() => (window as TestWindow).iconForgeLock!.publishRevision(5));
  await expect.poll(() => viewer.evaluate(() => (window as TestWindow).iconForgeRevisions)).toEqual([5]);
  await writer.evaluate(async () => (window as TestWindow).iconForgeLock!.close());
  await viewer.evaluate(async () => (window as TestWindow).iconForgeLock!.close());
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

test('S-06 browser download fallback produces a readable project archive', async ({ page }) => {
  await page.goto(baseUrl);
  const [download, result] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(async () => {
      const { ProjectDispatcher } = await import(new URL('/application.js', location.origin).href);
      const { saveProjectFile } = await import(new URL('/persistence.js', location.origin).href);
      const id = '0198e09b-a810-7000-8000-000000000035';
      const dispatcher = new ProjectDispatcher();
      dispatcher.dispatch({ commandVersion: '1.0', projectId: id, commandId: '0198e09b-a810-7000-8000-000000000036',
        issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' }, type: 'project.create', payload: { id, name: 'Medical' } });
      const previous = Object.getOwnPropertyDescriptor(globalThis, 'showSaveFilePicker');
      Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: undefined });
      try { return await saveProjectFile(dispatcher.project); }
      finally {
        if (previous) Object.defineProperty(globalThis, 'showSaveFilePicker', previous);
        else delete (globalThis as typeof globalThis & { showSaveFilePicker?: unknown }).showSaveFilePicker;
      }
    }),
  ]);
  expect(result).toEqual({ method: 'download', revision: 1 });
  expect(download.suggestedFilename()).toBe('Medical.iconproj');
  const saved = await readFile(await download.path());
  const archive = await decodeProjectArchive(new Uint8Array(saved));
  expect(archive.project).toMatchObject({ name: 'Medical', revision: 1 });
});

test('S-06 quota failure leaves no partial committed project', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'CDP quota override is Chromium-only');
  await page.goto(baseUrl);
  const session = await context.newCDPSession(page);
  await session.send('Storage.overrideQuotaForOrigin', { origin: baseUrl, quotaSize: 1 });
  try {
    const result = await page.evaluate(async () => {
      const { ProjectDispatcher } = await import(new URL('/application.js', location.origin).href);
      const { DexieProjectRepository } = await import(new URL('/persistence.js', location.origin).href);
      const id = '0198e09b-a810-7000-8000-000000000050';
      const dispatcher = new ProjectDispatcher();
      dispatcher.dispatch({ commandVersion: '1.0', projectId: id, commandId: '0198e09b-a810-7000-8000-000000000051',
        issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' }, type: 'project.create', payload: { id, name: 'Medical' } });
      const repository = new DexieProjectRepository('iconforge-s06-quota');
      let errorCode = '';
      try { await repository.append(id, 0, 1, dispatcher.journal[0]); }
      catch (error) { errorCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code : error instanceof Error ? error.name : ''; }
      const saved = await repository.load(id);
      repository.close();
      return { errorCode, saved };
    });
    expect(result.errorCode).toBe('quota-exceeded');
    expect(result.saved).toBeNull();
  } finally {
    await session.send('Storage.overrideQuotaForOrigin', { origin: baseUrl });
    await session.detach();
  }
});

test('S-06 closing a tab during append leaves an atomic journal state', async ({ page, context }) => {
  await page.goto(baseUrl);
  const id = '0198e09b-a810-7000-8000-000000000060';
  await page.evaluate(async id => {
    const { ProjectDispatcher } = await import(new URL('/application.js', location.origin).href);
    const { DexieProjectRepository } = await import(new URL('/persistence.js', location.origin).href);
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch({ commandVersion: '1.0', projectId: id, commandId: '0198e09b-a810-7000-8000-000000000061',
      issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' }, type: 'project.create', payload: { id, name: 'Medical' } });
    const repository = new DexieProjectRepository('iconforge-s06-interrupted');
    void repository.append(id, 0, 1, dispatcher.journal[0]).catch(() => {});
  }, id);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(baseUrl);
  const saved = await reopened.evaluate(async id => {
    const { DexieProjectRepository } = await import(new URL('/persistence.js', location.origin).href);
    const repository = new DexieProjectRepository('iconforge-s06-interrupted');
    const row = await repository.load(id);
    repository.close();
    return row === null ? null : { revision: row.revision, entries: row.journal.length, snapshot: row.snapshot };
  }, id);
  expect(saved === null || (saved.revision === 1 && saved.entries === 1 && saved.snapshot === null)).toBe(true);
  await reopened.close();
});

test('S-06 abort after an in-flight journal put preserves the prior revision', async ({ page }) => {
  await page.goto(baseUrl);
  const result = await page.evaluate(async () => {
    const { ProjectDispatcher } = await import(new URL('/application.js', location.origin).href);
    const { DexieProjectRepository } = await import(new URL('/persistence.js', location.origin).href);
    const id = '0198e09b-a810-7000-8000-000000000070';
    const base = { commandVersion: '1.0', projectId: id, issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' } };
    const dispatcher = new ProjectDispatcher();
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000071', type: 'project.create',
      payload: { id, name: 'Medical' } });
    const repository = new DexieProjectRepository('iconforge-s06-inflight-abort');
    await repository.append(id, 0, 1, dispatcher.journal[0]);
    dispatcher.dispatch({ ...base, commandId: '0198e09b-a810-7000-8000-000000000072', type: 'project.rename',
      payload: { name: 'Clinical' }, expectedRevision: 1 });
    const originalPut = IDBObjectStore.prototype.put;
    let injected = false;
    IDBObjectStore.prototype.put = function (...args) {
      const request = Reflect.apply(originalPut, this, args) as IDBRequest;
      if (this.name === 'projects' && !injected) {
        injected = true;
        request.addEventListener('success', () => this.transaction.abort());
      }
      return request;
    };
    let failed = false;
    try { await repository.append(id, 1, 2, dispatcher.journal[1]); }
    catch { failed = true; }
    finally { IDBObjectStore.prototype.put = originalPut; repository.close(); }
    const reopened = new DexieProjectRepository('iconforge-s06-inflight-abort');
    const row = await reopened.load(id);
    reopened.close();
    return { injected, failed, revision: row?.revision, entries: row?.journal.length,
      firstCommand: row?.journal[0]?.command.type };
  });
  expect(result).toEqual({ injected: true, failed: true, revision: 1, entries: 1, firstCommand: 'project.create' });
});
