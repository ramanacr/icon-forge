import { describe, expect, it } from 'vitest';
import { ProjectDispatcher } from '@iconforge/application';
import { canonicalJson, type IconV1 } from '@iconforge/project-model';
import { TransformGesture } from './transform-gesture.js';

const id = (part: number): string => `0198e09b-a810-7000-8000-${part.toString(16).padStart(12, '0')}`;
const base = { commandVersion: '1.0' as const, projectId: id(1), issuedAt: '2026-10-04T00:00:00Z',
  actor: { kind: 'user' as const } };
const icon: IconV1 = { id: id(4), name: 'two-boxes', aliases: [], tags: [], viewBox: [0, 0, 24, 24],
  variants: [], accessibility: { kind: 'decorative' }, provenanceIds: [],
  nodes: [5, 6].map((part, index) => ({ id: id(part), type: 'rect' as const, visible: true, locked: false,
    x: index * 10, y: 0, width: 8, height: 8, rx: 0, ry: 0 })) };
function dispatcher(): ProjectDispatcher {
  const result = new ProjectDispatcher();
  result.dispatch({ ...base, commandId: id(2), type: 'project.create', payload: { id: id(1), name: 'Medical' } });
  result.dispatch({ ...base, commandId: id(3), type: 'icon.add', payload: { icon } });
  return result;
}

describe('transform gesture', () => {
  it('keeps preview frames ephemeral and commits once with replayable undo', () => {
    const app = dispatcher();
    const initial = canonicalJson(app.project);
    const journalLength = app.journal.length;
    const gesture = new TransformGesture(app, { ...base, commandId: id(7), iconId: icon.id,
      nodeIds: [icon.nodes[0]!.id, icon.nodes[1]!.id] });
    for (let step = 1; step <= 100; step++) gesture.update([1, 0, 0, 1, step / 100, 0]);
    const preview = gesture.preview;
    preview.nodeIds.pop();
    preview.matrix[4] = 99;
    expect(gesture.preview.nodeIds).toHaveLength(2);
    expect(gesture.preview.matrix[4]).toBe(1);
    expect(app.journal).toHaveLength(journalLength);
    expect(canonicalJson(app.project)).toBe(initial);
    expect(gesture.commit()?.revision).toBe(3);
    expect(app.journal).toHaveLength(journalLength + 1);
    expect(app.project?.icons[0]?.nodes.map(node => node.transform)).toEqual([
      [1, 0, 0, 1, 1, 0], [1, 0, 0, 1, 1, 0],
    ]);
    expect(ProjectDispatcher.replay(null, app.journal).project).toEqual(app.project);
    app.dispatch({ ...base, commandId: id(8), type: 'history.undo', payload: {} });
    expect(app.project?.icons[0]).toEqual(icon);
    expect(() => gesture.commit()).toThrow('gesture.finished');
  });

  it('cancels identity and cancelled gestures without journaling', () => {
    const app = dispatcher();
    const request = { ...base, commandId: id(9), iconId: icon.id, nodeIds: [icon.nodes[0]!.id] };
    const identity = new TransformGesture(app, request);
    expect(identity.commit()).toBeNull();
    const cancelled = new TransformGesture(app, { ...request, commandId: id(10) });
    cancelled.update([1, 0, 0, 1, 3, 4]);
    cancelled.cancel();
    expect(app.journal).toHaveLength(2);
    expect(app.revision).toBe(2);
    expect(() => cancelled.update([1, 0, 0, 1, 5, 6])).toThrow('gesture.finished');
  });

  it('rejects stale commits and invalid target or matrix', () => {
    const app = dispatcher();
    expect(() => new TransformGesture(app, { ...base, commandId: id(11), iconId: icon.id,
      nodeIds: [id(99)] })).toThrow('node.not-found');
    const gesture = new TransformGesture(app, { ...base, commandId: id(12), iconId: icon.id,
      nodeIds: [icon.nodes[0]!.id] });
    expect(() => gesture.update([1, 0, 0, 1, 0.0001, 0])).toThrow('gesture.matrix.invalid');
    gesture.update([1, 0, 0, 1, 2, 0]);
    app.dispatch({ ...base, commandId: id(13), type: 'project.rename', payload: { name: 'New name' } });
    expect(() => gesture.commit()).toThrow('revision.conflict');
    expect(app.journal).toHaveLength(3);
    expect(() => gesture.commit()).toThrow('gesture.finished');
  });

  it('ignores extra runtime fields when constructing the commit command', () => {
    const app = dispatcher();
    const input = { ...base, commandId: id(14), iconId: icon.id, nodeIds: [icon.nodes[0]!.id],
      dryRun: true, expectedRevision: 999 };
    const gesture = new TransformGesture(app, input);
    gesture.update([1, 0, 0, 1, 2, 0]);
    expect(gesture.commit()?.status).toBe('applied');
    expect(app.journal).toHaveLength(3);
  });
});
