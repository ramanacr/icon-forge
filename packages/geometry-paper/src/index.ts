import paperCore from 'paper/dist/paper-core.js';
import { quantize, type PathDataV1, type SubpathV1 } from '@iconforge/project-model';
import type { BooleanOp, BooleanResult, IGeometryEngine } from '@iconforge/geometry';

const paper = paperCore as unknown as typeof import('paper');
type PaperScope = InstanceType<(typeof import('paper'))['PaperScope']>;
type PathItem = InstanceType<(typeof import('paper'))['PathItem']>;
type Path = InstanceType<(typeof import('paper'))['Path']>;

function toPaperPath(scope: PaperScope, data: PathDataV1): PathItem {
  const paths = data.map(subpath => {
    const path = new scope.Path({ insert: false });
    path.moveTo(new scope.Point(...subpath.start));
    for (const segment of subpath.segments) {
      if (segment.k === 'L') path.lineTo(new scope.Point(...segment.to));
      else if (segment.k === 'Q') path.quadraticCurveTo(new scope.Point(...segment.c), new scope.Point(...segment.to));
      else path.cubicCurveTo(new scope.Point(...segment.c1), new scope.Point(...segment.c2), new scope.Point(...segment.to));
    }
    path.closed = true;
    return path;
  });
  return paths.length === 1 ? paths[0]! : new scope.CompoundPath({ children: paths, insert: false });
}

function fromPaperPath(item: PathItem): PathDataV1 {
  const paths = item instanceof paper.CompoundPath ? item.children as Path[] : [item as Path];
  return paths.filter(path => path.segments.length > 0).map(path => {
    const segments = path.segments;
    const start = [quantize(segments[0]!.point.x), quantize(segments[0]!.point.y)] as [number, number];
    const output: SubpathV1 = { start, segments: [], closed: path.closed };
    const count = path.closed ? segments.length : segments.length - 1;
    for (let index = 0; index < count; index++) {
      const source = segments[index]!;
      const target = segments[(index + 1) % segments.length]!;
      const to = [quantize(target.point.x), quantize(target.point.y)] as [number, number];
      const first = [quantize(source.point.x + source.handleOut.x), quantize(source.point.y + source.handleOut.y)] as [number, number];
      const second = [quantize(target.point.x + target.handleIn.x), quantize(target.point.y + target.handleIn.y)] as [number, number];
      if (first[0] === quantize(source.point.x) && first[1] === quantize(source.point.y)
        && second[0] === to[0] && second[1] === to[1]) {
        if (index < count - 1 || !path.closed) output.segments.push({ k: 'L', to });
      } else {
        output.segments.push({ k: 'C', c1: first, c2: second, to });
      }
    }
    return output;
  });
}

export class PaperGeometryEngine implements IGeometryEngine {
  boolean(left: PathDataV1, right: PathDataV1, op: BooleanOp): BooleanResult {
    if (!left.length || !right.length || [...left, ...right].some(subpath => !subpath.closed || !subpath.segments.length)) {
      return { path: null, diagnostics: [{ code: 'boolean.invalid-input', severity: 'error' }] };
    }
    const scope = new paper.PaperScope();
    scope.setup(new scope.Size(1, 1));
    try {
      const first = toPaperPath(scope, left);
      const second = toPaperPath(scope, right);
      const output = op === 'union' ? first.unite(second, { insert: false })
        : op === 'subtract' ? first.subtract(second, { insert: false })
          : op === 'intersect' ? first.intersect(second, { insert: false })
            : first.exclude(second, { insert: false });
      return { path: fromPaperPath(output), diagnostics: [] };
    } catch {
      return { path: null, diagnostics: [{ code: 'boolean.unsupported-geometry', severity: 'error' }] };
    } finally {
      scope.project.remove();
    }
  }
}
