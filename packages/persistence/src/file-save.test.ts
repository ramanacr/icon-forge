import { describe, expect, it } from 'vitest';
import { ProjectDispatcher } from '@iconforge/application';
import { unzipSync } from 'fflate';
import { decodeProjectArchive } from './project-archive.js';
import { encodeBuildArchive, saveProjectFile } from './file-save.js';

const id = '0198e09b-a810-7000-8000-000000000001';
const dispatcher = new ProjectDispatcher();
dispatcher.dispatch({ commandVersion: '1.0', projectId: id, commandId: '0198e09b-a810-7000-8000-000000000002',
  issuedAt: '2026-10-02T00:00:00Z', actor: { kind: 'user' }, type: 'project.create', payload: { id, name: 'Medical' } });
const project = dispatcher.project!;

describe('project file save', () => {
  it('writes to a bound file handle and closes it before reporting saved', async () => {
    const steps: string[] = [];
    let saved: Uint8Array | undefined;
    const handle = { createWritable: async () => ({
      write: async (bytes: Uint8Array) => { steps.push('write'); saved = bytes; },
      close: async () => { steps.push('close'); },
    }) };
    const result = await saveProjectFile(project, { handle });
    expect(result).toEqual({ method: 'file', handle, revision: project.revision });
    expect(steps).toEqual(['write', 'close']);
    expect((await decodeProjectArchive(saved!)).project).toEqual(project);
  });

  it('downloads when the native picker is unavailable', async () => {
    let name = '';
    const result = await saveProjectFile(project, { download: async (filename, bytes) => {
      name = filename;
      expect((await decodeProjectArchive(bytes)).project).toEqual(project);
    } });
    expect(name).toBe('Medical.iconproj');
    expect(result).toEqual({ method: 'download', revision: project.revision });
  });

  it('does not report saved if the write fails', async () => {
    const handle = { createWritable: async () => ({
      write: async () => { throw new Error('disk full'); }, close: async () => {},
    }) };
    await expect(saveProjectFile(project, { handle })).rejects.toThrow('disk full');
  });

  it('packs build artifacts deterministically and rejects unsafe paths', () => {
    const artifacts = { 'usage.html': new TextEncoder().encode('<html/>'),
      'sprite.svg': new TextEncoder().encode('<svg/>') };
    const manifest = new TextEncoder().encode('{}');
    const first = encodeBuildArchive(artifacts, manifest);
    expect(encodeBuildArchive(artifacts, manifest)).toEqual(first);
    expect(unzipSync(first)).toEqual({ ...artifacts, 'manifest.json': manifest });
    expect(() => encodeBuildArchive({ '../escape': manifest }, manifest)).toThrow('build-archive.path');
  });
});
