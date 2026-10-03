import { describe, expect, it } from 'vitest';
import type { ProjectV1 } from './types.js';
import { openProjectDocument, type MigrationStep } from './migrations.js';

const current: ProjectV1 = {
  schemaVersion: '1.0', id: '0198e09b-a810-7000-8000-000000000001', name: 'Medical', revision: 1,
  designSystem: { grid: { width: 24, height: 24 }, safeArea: { top: 2, right: 2, bottom: 2, left: 2 },
    style: 'outline', stroke: { width: 1.75, cap: 'round', join: 'round', miterLimit: 4 }, cornerRadius: 2,
    defaultPaintToken: 'currentColor', naming: { pattern: 'kebab', reserved: [] }, severities: {} },
  tokens: [], components: [], icons: [], exportProfiles: [], provenance: [],
};

describe('project migrations', () => {
  it('loads current documents as defensive copies', () => {
    const opened = openProjectDocument(current);
    expect(opened).toEqual({ mode: 'read-write', project: current, migratedFrom: null });
    if (opened.mode !== 'read-write') throw new Error('Expected current document');
    opened.project.name = 'Changed';
    expect(current.name).toBe('Medical');
  });

  it('applies ordered pure steps and validates the final quantized document', () => {
    const older = { ...current, schemaVersion: '0.9', designSystem: { ...current.designSystem, cornerRadius: 1.2345 } };
    const before = structuredClone(older);
    const steps: MigrationStep[] = [{ from: '0.9', to: '1.0', migrate: input => ({ ...input, schemaVersion: '1.0',
      designSystem: { ...(input.designSystem as object), cornerRadius: 1.234 } }) }];
    const opened = openProjectDocument(older, steps);
    expect(older).toEqual(before);
    expect(opened.mode).toBe('read-write');
    if (opened.mode !== 'read-write') throw new Error('Expected migrated document');
    expect(opened.migratedFrom).toBe('0.9');
    expect(opened.project.designSystem.cornerRadius).toBe(1.234);
    expect(() => openProjectDocument(older, [{ ...steps[0]!, migrate: input => ({ ...input, schemaVersion: '1.0',
      designSystem: { ...(input.designSystem as object), cornerRadius: 1.2345 } }) }])).toThrow();
  });

  it('keeps future major documents read-only and preserves their original data', () => {
    const future = { ...current, schemaVersion: '2.0', futureField: { value: 7 } };
    const opened = openProjectDocument(future);
    expect(opened).toEqual({ mode: 'read-only', reason: 'future-major', original: future });
    if (opened.mode !== 'read-only') throw new Error('Expected read-only document');
    (opened.original as typeof future).futureField.value = 9;
    expect(future.futureField.value).toBe(7);
  });

  it('rejects an older version without a registered migration', () => {
    expect(() => openProjectDocument({ ...current, schemaVersion: '0.9' })).toThrow('migration.unavailable');
  });
});
