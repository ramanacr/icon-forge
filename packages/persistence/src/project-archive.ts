import { unzipSync, zipSync, type Zippable } from 'fflate';
import { assertProject, canonicalJson, type ProjectV1 } from '@iconforge/project-model';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const ZIP_EPOCH = new Date('1980-01-01T00:00:00Z');

export interface ProjectArchive {
  project: ProjectV1;
  attachments: Record<string, Uint8Array>;
}

async function hexSha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function assertAttachmentPath(path: string): void {
  const valid = /^originals\/[0-9a-f]{64}\.svg$/.test(path)
    || /^extensions\/[A-Za-z0-9_-]+\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(path);
  if (!valid || path.split('/').some(part => part === '..' || part === '.')) throw new TypeError('project-archive.path');
}

async function assertOriginalHash(path: string, bytes: Uint8Array): Promise<void> {
  if (path.startsWith('originals/') && path.slice(10, -4) !== await hexSha256(bytes)) {
    throw new TypeError('project-archive.original-hash-mismatch');
  }
}

export async function encodeProjectArchive(
  project: ProjectV1,
  attachments: Record<string, Uint8Array> = {},
): Promise<Uint8Array> {
  assertProject(project);
  const projectBytes = encoder.encode(canonicalJson(project));
  const manifest = {
    format: 'iconforge-project', formatVersion: 1, schemaVersion: project.schemaVersion,
    projectId: project.id, contentSha256: await hexSha256(projectBytes),
  };
  const files: Zippable = {
    'manifest.json': encoder.encode(canonicalJson(manifest)),
    'project.json': projectBytes,
  };
  for (const path of Object.keys(attachments).sort()) {
    assertAttachmentPath(path);
    await assertOriginalHash(path, attachments[path]!);
    files[path] = attachments[path]!;
  }
  return zipSync(files, { mtime: ZIP_EPOCH, level: 9 });
}

export async function decodeProjectArchive(bytes: Uint8Array): Promise<ProjectArchive> {
  const files = unzipSync(bytes);
  if (!files['manifest.json'] || !files['project.json']) throw new TypeError('project-archive.missing-entry');
  for (const path of Object.keys(files)) {
    if (path !== 'manifest.json' && path !== 'project.json') assertAttachmentPath(path);
  }
  const manifest: unknown = JSON.parse(decoder.decode(files['manifest.json']));
  const projectBytes = files['project.json'];
  if (typeof manifest !== 'object' || manifest === null || !('format' in manifest)
    || manifest.format !== 'iconforge-project' || !('formatVersion' in manifest) || manifest.formatVersion !== 1
    || !('contentSha256' in manifest) || manifest.contentSha256 !== await hexSha256(projectBytes)) {
    throw new TypeError('project-archive.hash-mismatch');
  }
  const project = assertProject(JSON.parse(decoder.decode(projectBytes)));
  if (!('projectId' in manifest) || manifest.projectId !== project.id
    || !('schemaVersion' in manifest) || manifest.schemaVersion !== project.schemaVersion
    || decoder.decode(projectBytes) !== canonicalJson(project)) throw new TypeError('project-archive.invalid-manifest');
  const attachments: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(files)) {
    if (path !== 'manifest.json' && path !== 'project.json') {
      await assertOriginalHash(path, data);
      attachments[path] = data;
    }
  }
  return { project, attachments };
}
