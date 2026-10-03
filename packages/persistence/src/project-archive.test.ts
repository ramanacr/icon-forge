import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import { ProjectDispatcher } from '@iconforge/application';
import { canonicalJson } from '@iconforge/project-model';
import { decodeProjectArchive, encodeProjectArchive } from './project-archive.js';

const id = '0198e09b-a810-7000-8000-000000000001';
const dispatcher = new ProjectDispatcher();
dispatcher.dispatch({ commandVersion: '1.0', projectId: id, commandId: '0198e09b-a810-7000-8000-000000000002',
  issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' }, type: 'project.create', payload: { id, name: 'Medical' } });
const project = dispatcher.project!;

describe('.iconproj ZIP', () => {
  it('encodes deterministic bytes and validates the project hash on read', async () => {
    const first = await encodeProjectArchive(project);
    const second = await encodeProjectArchive(project);
    expect(first).toEqual(second);
    const entries = unzipSync(first);
    expect(Object.keys(entries).sort()).toEqual(['manifest.json', 'project.json']);
    expect(new TextDecoder().decode(entries['project.json'])).toBe(canonicalJson(project));
    const opened = await decodeProjectArchive(first);
    expect(opened.project).toEqual(project);
  });

  it('rejects a modified project even when the ZIP itself is valid', async () => {
    const entries = unzipSync(await encodeProjectArchive(project));
    entries['project.json'] = new TextEncoder().encode(canonicalJson({ ...project, name: 'Tampered' }));
    await expect(decodeProjectArchive(zipSync(entries))).rejects.toThrow('project-archive.hash-mismatch');
  });

  it('preserves originals and extension payloads', async () => {
    const original = new TextEncoder().encode('<svg/>');
    const hash = createHash('sha256').update(original).digest('hex');
    const bytes = await encodeProjectArchive(project, {
      [`originals/${hash}.svg`]: original,
      'extensions/vendor/data.bin': new Uint8Array([0, 1, 255]),
    });
    const opened = await decodeProjectArchive(bytes);
    expect(opened.attachments['extensions/vendor/data.bin']).toEqual(new Uint8Array([0, 1, 255]));
  });

  it('rejects arbitrary extra ZIP paths', async () => {
    await expect(encodeProjectArchive(project, { '../escape': new Uint8Array() })).rejects.toThrow('project-archive.path');
  });

  it('rejects an original whose path does not match its content', async () => {
    await expect(encodeProjectArchive(project, {
      'originals/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg': new TextEncoder().encode('<svg/>'),
    })).rejects.toThrow('project-archive.original-hash-mismatch');
  });

  it('rejects zip-slip paths and oversized decompression before extracting', async () => {
    const normal = unzipSync(await encodeProjectArchive(project));
    await expect(decodeProjectArchive(zipSync({ ...normal, '../escape.svg': new Uint8Array([1]) })))
      .rejects.toThrow('project-archive.path');
    const bomb = zipSync({ ...normal, 'extensions/vendor/large.bin': new Uint8Array(17 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(100_000);
    await expect(decodeProjectArchive(bomb)).rejects.toThrow('project-archive.size-limit');
  });
});
