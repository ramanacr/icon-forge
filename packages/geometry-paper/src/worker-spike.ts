import paper from 'paper';
import { quantize } from '@iconforge/project-model';
import { PaperGeometryEngine } from './index.js';

type SpikeResult = { domAvailable: boolean; canvasAvailable: boolean; areas?: Record<string, number>;
  edgeAreas?: Record<string, number>; inputsUnchanged?: boolean; canonicalResult?: unknown;
  invalidResult?: unknown; canonicalInputsUnchanged?: boolean; error?: string };

self.addEventListener('message', () => {
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
      return [name, quantize(paths.reduce((sum, path) => sum + Math.abs((path as paper.Path).area), 0))];
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
      return [name, quantize(paths.reduce((sum, path) => sum + Math.abs((path as paper.Path).area), 0))];
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
    result.canonicalInputsUnchanged = JSON.stringify(canonicalLeft) === originalLeft && JSON.stringify(canonicalRight) === originalRight;
    result.invalidResult = engine.boolean([{ ...canonicalLeft[0]!, closed: false }], canonicalRight, 'union');
  } catch (error) { result.error = String(error); }
  self.postMessage(result);
});
