import type { ProjectV1 } from '@iconforge/project-model';
import { encodeProjectArchive } from './project-archive.js';

export interface WritableProjectHandle {
  createWritable(): Promise<{ write(bytes: Uint8Array): Promise<void>; close(): Promise<void> }>;
}

export interface FileSaveOptions {
  handle?: WritableProjectHandle;
  picker?: (suggestedName: string) => Promise<WritableProjectHandle>;
  download?: (filename: string, bytes: Uint8Array) => Promise<void>;
  attachments?: Record<string, Uint8Array>;
}

export type FileSaveResult =
  | { method: 'file'; handle: WritableProjectHandle; revision: number }
  | { method: 'download'; revision: number };

function nativePicker(): FileSaveOptions['picker'] {
  const browser = globalThis as typeof globalThis & {
    showSaveFilePicker?: (options: unknown) => Promise<WritableProjectHandle>;
  };
  if (!browser.showSaveFilePicker) return undefined;
  return name => browser.showSaveFilePicker!({ suggestedName: name,
    types: [{ description: 'IconForge project', accept: { 'application/zip': ['.iconproj'] } }],
  });
}

async function browserDownload(filename: string, bytes: Uint8Array): Promise<void> {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Save a validated archive. A native handle remains bound for subsequent Ctrl/Cmd+S saves. */
export async function saveProjectFile(project: ProjectV1, options: FileSaveOptions = {}): Promise<FileSaveResult> {
  const bytes = await encodeProjectArchive(project, options.attachments);
  const filename = `${project.name.replace(/[^A-Za-z0-9 _.-]/g, '_').slice(0, 120) || 'project'}.iconproj`;
  const picker = options.picker ?? (options.download ? undefined : nativePicker());
  const handle = options.handle ?? (picker ? await picker(filename) : undefined);
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return { method: 'file', handle, revision: project.revision };
  }
  await (options.download ?? browserDownload)(filename, bytes);
  return { method: 'download', revision: project.revision };
}

/** Explicit backup action always downloads, including on browsers with a native picker. */
export async function downloadProjectFile(project: ProjectV1, attachments: Record<string, Uint8Array> = {}): Promise<void> {
  await saveProjectFile(project, { download: browserDownload, attachments });
}
