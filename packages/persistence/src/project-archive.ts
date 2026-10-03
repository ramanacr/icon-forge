import { unzipSync, zipSync, type Zippable } from 'fflate';
import { assertProject, canonicalJson, openProjectDocument, type MigrationStep, type ProjectV1 } from '@iconforge/project-model';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const ZIP_EPOCH = new Date('1980-01-01T00:00:00Z');
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

export interface ProjectArchive {
  project: ProjectV1;
  attachments: Record<string, Uint8Array>;
}
export type ProjectArchiveOpen =
  | { mode: 'read-write'; project: ProjectV1; migratedFrom: string | null; attachments: Record<string, Uint8Array> }
  | { mode: 'read-only'; reason: 'future-major' | 'unsupported-version'; original: unknown; attachments: Record<string, Uint8Array> };

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
  if (projectBytes.length > MAX_ENTRY_BYTES || Object.keys(attachments).length + 2 > MAX_ENTRIES) {
    throw new TypeError('project-archive.size-limit');
  }
  const manifest = {
    format: 'iconforge-project', formatVersion: 1, schemaVersion: project.schemaVersion,
    projectId: project.id, contentSha256: await hexSha256(projectBytes),
  };
  const manifestBytes = encoder.encode(canonicalJson(manifest));
  const files: Zippable = {
    'manifest.json': manifestBytes,
    'project.json': projectBytes,
  };
  let totalSize = projectBytes.length + manifestBytes.length;
  for (const path of Object.keys(attachments).sort()) {
    assertAttachmentPath(path);
    if (attachments[path]!.length > MAX_ENTRY_BYTES) throw new TypeError('project-archive.size-limit');
    totalSize += attachments[path]!.length;
    if (totalSize > MAX_ARCHIVE_BYTES) throw new TypeError('project-archive.size-limit');
    await assertOriginalHash(path, attachments[path]!);
    files[path] = attachments[path]!;
  }
  const archive = zipSync(files, { mtime: ZIP_EPOCH, level: 9 });
  if (archive.length > MAX_ARCHIVE_BYTES) throw new TypeError('project-archive.size-limit');
  return archive;
}

export async function openProjectArchive(bytes: Uint8Array, migrations: readonly MigrationStep[] = []): Promise<ProjectArchiveOpen> {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new TypeError('project-archive.size-limit');
  const names = new Set<string>();
  let totalSize = 0;
  const files = unzipSync(bytes, { filter: info => {
    if (info.name !== 'manifest.json' && info.name !== 'project.json') assertAttachmentPath(info.name);
    if (names.has(info.name)) throw new TypeError('project-archive.duplicate-entry');
    names.add(info.name);
    totalSize += info.originalSize;
    if (names.size > MAX_ENTRIES || !Number.isSafeInteger(info.originalSize)
      || info.originalSize > MAX_ENTRY_BYTES || totalSize > MAX_ARCHIVE_BYTES) {
      throw new TypeError('project-archive.size-limit');
    }
    return true;
  } });
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
  const document: unknown = JSON.parse(decoder.decode(projectBytes));
  if (typeof document !== 'object' || document === null || !('id' in document) || !('schemaVersion' in document)
    || !('projectId' in manifest) || manifest.projectId !== document.id
    || !('schemaVersion' in manifest) || manifest.schemaVersion !== document.schemaVersion
    || decoder.decode(projectBytes) !== canonicalJson(document)) throw new TypeError('project-archive.invalid-manifest');
  const attachments: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(files)) {
    if (path !== 'manifest.json' && path !== 'project.json') {
      await assertOriginalHash(path, data);
      attachments[path] = data;
    }
  }
  return { ...openProjectDocument(document, migrations), attachments };
}

export async function decodeProjectArchive(bytes: Uint8Array): Promise<ProjectArchive> {
  const opened = await openProjectArchive(bytes);
  if (opened.mode === 'read-only') throw new TypeError('project-archive.read-only');
  return { project: opened.project, attachments: opened.attachments };
}
