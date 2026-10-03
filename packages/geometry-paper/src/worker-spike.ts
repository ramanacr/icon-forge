import paperCore from 'paper/dist/paper-core.js';
import { quantize } from '@iconforge/project-model';
import { PaperGeometryEngine } from './index.js';

const paper = paperCore as unknown as typeof import('paper');
type Path = InstanceType<(typeof import('paper'))['Path']>;

type SpikeResult = { domAvailable: boolean; canvasAvailable: boolean; areas?: Record<string, number>;
  edgeAreas?: Record<string, number>; inputsUnchanged?: boolean; canonicalResult?: unknown;
  invalidResult?: unknown; canonicalInputsUnchanged?: boolean; canonicalOperations?: unknown; error?: string };

self.addEventListener('message', (event: MessageEvent) => {
  if (event.data?.case === 'thin-overlap') {
    const rectangle = (x: number) => [{ start: [x, 0] as [number, number], segments: [
      { k: 'L' as const, to: [x + 10, 0] as [number, number] },
      { k: 'L' as const, to: [x + 10, 10] as [number, number] },
      { k: 'L' as const, to: [x, 10] as [number, number] },
    ], closed: true }];
    const engine = new PaperGeometryEngine();
    const left = rectangle(0);
    const right = rectangle(9.9);
    const operations = {
      union: engine.boolean(left, right, 'union'),
      subtract: engine.boolean(left, right, 'subtract'),
      intersect: engine.boolean(left, right, 'intersect'),
      exclude: engine.boolean(left, right, 'exclude'),
    };
    self.postMessage({ operations, left, right });
    return;
  }
  if (event.data?.case === 'curved') {
    const engine = new PaperGeometryEngine();
    const radius = 10;
    const tangent = radius * 0.5522847498307936;
    const left = [{ start: [20, 10] as [number, number], segments: [
      { k: 'C' as const, c1: [20, 10 + tangent] as [number, number], c2: [10 + tangent, 20] as [number, number], to: [10, 20] as [number, number] },
      { k: 'C' as const, c1: [10 - tangent, 20] as [number, number], c2: [0, 10 + tangent] as [number, number], to: [0, 10] as [number, number] },
      { k: 'C' as const, c1: [0, 10 - tangent] as [number, number], c2: [10 - tangent, 0] as [number, number], to: [10, 0] as [number, number] },
      { k: 'C' as const, c1: [10 + tangent, 0] as [number, number], c2: [20, 10 - tangent] as [number, number], to: [20, 10] as [number, number] },
    ], closed: true }];
    const right = [{ start: [10, 5] as [number, number], segments: [
      { k: 'L' as const, to: [25, 5] as [number, number] },
      { k: 'L' as const, to: [25, 15] as [number, number] },
      { k: 'L' as const, to: [10, 15] as [number, number] },
    ], closed: true }];
    const original = JSON.stringify({ left, right });
    const operations = {
      union: engine.boolean(left, right, 'union'),
      subtract: engine.boolean(left, right, 'subtract'),
      intersect: engine.boolean(left, right, 'intersect'),
      exclude: engine.boolean(left, right, 'exclude'),
    };
    self.postMessage({ operations, left, right, inputsUnchanged: JSON.stringify({ left, right }) === original });
    return;
  }
  Object.defineProperty(self, 'OffscreenCanvas', { configurable: true, value: undefined });
  const result: SpikeResult = { domAvailable: typeof document !== 'undefined', canvasAvailable: typeof OffscreenCanvas !== 'undefined' };
  try {
    const scope = new paper.PaperScope();
    scope.setup(new scope.Size(1, 1));
    const left = new scope.Path.Rectangle({ rectangle: new scope.Rectangle(0, 0, 10, 10), insert: false });
    const right = new scope.Path.Rectangle({ rectangle: new scope.Rectangle(5, 0, 10, 10), insert: false });
    const before = [left.pathData, right.pathData];
    const operations = {
      union: left.unite(right, { insert: false }),
      subtract: left.subtract(right, { insert: false }),
      intersect: left.intersect(right, { insert: false }),
      exclude: left.exclude(right, { insert: false }),
    };
    result.areas = Object.fromEntries(Object.entries(operations).map(([name, output]) => {
      const paths = output instanceof scope.CompoundPath ? output.children : [output];
      return [name, quantize(paths.reduce((sum, path) => sum + Math.abs((path as Path).area), 0))];
    }));
    result.inputsUnchanged = left.pathData === before[0] && right.pathData === before[1];
    const coincident = new scope.Path.Rectangle({ rectangle: new scope.Rectangle(0, 0, 10, 10), insert: false });
    const touching = new scope.Path.Rectangle({ rectangle: new scope.Rectangle(10, 0, 10, 10), insert: false });
    const edgeCases = {
      coincidentUnion: left.unite(coincident, { insert: false }),
      coincidentIntersect: left.intersect(coincident, { insert: false }),
      touchingUnion: left.unite(touching, { insert: false }),
      touchingIntersect: left.intersect(touching, { insert: false }),
    };
    result.edgeAreas = Object.fromEntries(Object.entries(edgeCases).map(([name, output]) => {
      const paths = output instanceof scope.CompoundPath ? output.children : [output];
      return [name, quantize(paths.reduce((sum, path) => sum + Math.abs((path as Path).area), 0))];
    }));
    const rectangle = (x: number) => [{ start: [x, 0] as [number, number], segments: [
      { k: 'L' as const, to: [x + 10, 0] as [number, number] },
      { k: 'L' as const, to: [x + 10, 10] as [number, number] },
      { k: 'L' as const, to: [x, 10] as [number, number] },
    ], closed: true }];
    const engine = new PaperGeometryEngine();
    const canonicalLeft = rectangle(0);
    const canonicalRight = rectangle(5);
    const originalLeft = JSON.stringify(canonicalLeft);
    const originalRight = JSON.stringify(canonicalRight);
    result.canonicalResult = engine.boolean(canonicalLeft, canonicalRight, 'union');
    result.canonicalOperations = {
      union: result.canonicalResult,
      subtract: engine.boolean(canonicalLeft, canonicalRight, 'subtract'),
      intersect: engine.boolean(canonicalLeft, canonicalRight, 'intersect'),
      exclude: engine.boolean(canonicalLeft, canonicalRight, 'exclude'),
    };
    result.canonicalInputsUnchanged = JSON.stringify(canonicalLeft) === originalLeft && JSON.stringify(canonicalRight) === originalRight;
    result.invalidResult = engine.boolean([{ ...canonicalLeft[0]!, closed: false }], canonicalRight, 'union');
  } catch (error) { result.error = String(error); }
  self.postMessage(result);
});
