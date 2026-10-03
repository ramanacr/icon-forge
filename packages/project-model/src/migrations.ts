import type { ProjectV1 } from './types.js';
import { assertProject } from './validation.js';

export interface MigrationStep {
  from: string;
  to: string;
  migrate(input: Record<string, unknown>): Record<string, unknown>;
}

export type ProjectOpenResult =
  | { mode: 'read-write'; project: ProjectV1; migratedFrom: string | null }
  | { mode: 'read-only'; reason: 'future-major' | 'unsupported-version'; original: unknown };

const CURRENT_VERSION = '1.0';

function versionParts(version: unknown): [number, number] {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new TypeError('migration.version.invalid');
  }
  const [major, minor] = version.split('.').map(Number);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) throw new TypeError('migration.version.invalid');
  return [major!, minor!];
}

/** Opens a current project or migrates an older version without mutating caller data. */
export function openProjectDocument(input: unknown, steps: readonly MigrationStep[] = []): ProjectOpenResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || !('schemaVersion' in input)) {
    throw new TypeError('migration.document.invalid');
  }
  let document = structuredClone(input) as Record<string, unknown>;
  const originalVersion = document.schemaVersion;
  const [major, minor] = versionParts(originalVersion);
  if (major > 1 || (major === 1 && minor > 0)) {
    return { mode: 'read-only', reason: major > 1 ? 'future-major' : 'unsupported-version', original: document };
  }
  const byFrom = new Map<string, MigrationStep>();
  for (const step of steps) {
    if (byFrom.has(step.from)) throw new TypeError('migration.duplicate-step');
    byFrom.set(step.from, step);
  }
  let version = originalVersion as string;
  let count = 0;
  while (version !== CURRENT_VERSION) {
    if (++count > 32) throw new TypeError('migration.chain.too-long');
    const step = byFrom.get(version);
    if (!step) throw new TypeError('migration.unavailable');
    const [fromMajor, fromMinor] = versionParts(step.from);
    const [toMajor, toMinor] = versionParts(step.to);
    if (toMajor < fromMajor || (toMajor === fromMajor && toMinor <= fromMinor)
      || toMajor > 1 || (toMajor === 1 && toMinor > 0)) throw new TypeError('migration.step.invalid');
    document = step.migrate(structuredClone(document));
    if (document.schemaVersion !== step.to) throw new TypeError('migration.output-version.invalid');
    version = step.to;
  }
  return { mode: 'read-write', project: assertProject(document), migratedFrom: originalVersion === CURRENT_VERSION ? null : originalVersion as string };
}
