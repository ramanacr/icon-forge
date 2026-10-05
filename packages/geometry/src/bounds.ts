import {
  assertProject, canonicalJson, instantiateComponentNodes, resolveVariantNodes,
  type IconV1, type MatrixV1, type ProjectV1, type SceneNodeV1,
} from '@iconforge/project-model';

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
type Point = [number, number];
const IDENTITY: MatrixV1 = [1, 0, 0, 1, 0, 0];

function compose(parent: MatrixV1, child: MatrixV1): MatrixV1 {
  const [a, b, c, d, e, f] = parent;
  const [g, h, i, j, k, l] = child;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j,
    a * k + c * l + e, b * k + d * l + f];
}

function transform(matrix: MatrixV1, point: Point): Point {
  return [matrix[0] * point[0] + matrix[2] * point[1] + matrix[4],
    matrix[1] * point[0] + matrix[3] * point[1] + matrix[5]];
}

function include(bounds: Bounds | null, [x, y]: Point): Bounds {
  return bounds ? { minX: Math.min(bounds.minX, x), minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x), maxY: Math.max(bounds.maxY, y) }
    : { minX: x, minY: y, maxX: x, maxY: y };
}

function merge(left: Bounds | null, right: Bounds | null): Bounds | null {
  if (!left) return right;
  if (!right) return left;
  return { minX: Math.min(left.minX, right.minX), minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX), maxY: Math.max(left.maxY, right.maxY) };
}

function quadratic(p0: number, p1: number, p2: number, t: number): number {
  const s = 1 - t;
  return s * s * p0 + 2 * s * t * p1 + t * t * p2;
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const s = 1 - t;
  return s * s * s * p0 + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t * t * t * p3;
}

function quadraticRoots(p0: number, p1: number, p2: number): number[] {
  const denominator = p0 - 2 * p1 + p2;
  if (denominator === 0) return [];
  const t = (p0 - p1) / denominator;
  return t > 0 && t < 1 ? [t] : [];
}

function cubicRoots(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (a === 0) {
    if (b === 0) return [];
    const t = -c / b;
    return t > 0 && t < 1 ? [t] : [];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(t => t > 0 && t < 1);
}

function nodeBounds(project: ProjectV1, node: SceneNodeV1, parent: MatrixV1): Bounds | null {
  if (!node.visible) return null;
  const matrix = node.transform ? compose(parent, node.transform) : parent;
  if (node.type === 'group' || node.type === 'instance') {
    const children = node.type === 'group' ? node.children : instantiateComponentNodes(project, node);
    return children.reduce<Bounds | null>((bounds, child) => merge(bounds, nodeBounds(project, child, matrix)), null);
  }
  let bounds: Bounds | null = null;
  const add = (point: Point): void => { bounds = include(bounds, transform(matrix, point)); };
  if (node.type === 'rect') {
    add([node.x, node.y]);
    add([node.x + node.width, node.y]);
    add([node.x, node.y + node.height]);
    add([node.x + node.width, node.y + node.height]);
  } else if (node.type === 'ellipse') {
    const [cx, cy] = transform(matrix, [node.cx, node.cy]);
    const dx = Math.hypot(matrix[0] * node.rx, matrix[2] * node.ry);
    const dy = Math.hypot(matrix[1] * node.rx, matrix[3] * node.ry);
    bounds = { minX: cx - dx, minY: cy - dy, maxX: cx + dx, maxY: cy + dy };
  } else if (node.type === 'line') {
    add([node.x1, node.y1]);
    add([node.x2, node.y2]);
  } else if (node.type === 'polyline') {
    for (let index = 0; index < node.points.length; index += 2) add([node.points[index]!, node.points[index + 1]!]);
  } else {
    for (const subpath of node.path) {
      let current = transform(matrix, subpath.start);
      bounds = include(bounds, current);
      for (const segment of subpath.segments) {
        const end = transform(matrix, segment.to);
        bounds = include(bounds, end);
        if (segment.k === 'Q') {
          const control = transform(matrix, segment.c);
          const roots = [...quadraticRoots(current[0], control[0], end[0]),
            ...quadraticRoots(current[1], control[1], end[1])];
          for (const t of roots) bounds = include(bounds, [quadratic(current[0], control[0], end[0], t),
            quadratic(current[1], control[1], end[1], t)]);
        } else if (segment.k === 'C') {
          const first = transform(matrix, segment.c1);
          const second = transform(matrix, segment.c2);
          const roots = [...cubicRoots(current[0], first[0], second[0], end[0]),
            ...cubicRoots(current[1], first[1], second[1], end[1])];
          for (const t of roots) bounds = include(bounds, [cubic(current[0], first[0], second[0], end[0], t),
            cubic(current[1], first[1], second[1], end[1], t)]);
        }
        current = end;
      }
    }
  }
  return bounds;
}

/** Bounds of visible scene geometry in icon coordinates. Stroke expansion is excluded;
 * rotated rounded rectangles may have conservative corner bounds. */
export function iconGeometryBounds(input: ProjectV1, iconInput: IconV1, variantId?: string): Bounds | null {
  const project = assertProject(input);
  const icon = project.icons.find(candidate => candidate.id === iconInput.id);
  if (!icon || canonicalJson(icon) !== canonicalJson(iconInput)) throw new TypeError('geometry.icon.not-in-project');
  return resolveVariantNodes(icon, variantId)
    .reduce<Bounds | null>((bounds, node) => merge(bounds, nodeBounds(project, node, IDENTITY)), null);
}
