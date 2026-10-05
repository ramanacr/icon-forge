type Point = [number, number];
type ViewBox = [number, number, number, number];
export interface GridSnap { point: Point; snappedX: boolean; snappedY: boolean }
export interface GridGuides { vertical: number[]; horizontal: number[] }

function validate(spacing: Point, origin: Point): void {
  if (spacing.some(value => !Number.isFinite(value) || value <= 0)) throw new TypeError('grid.spacing.invalid');
  if (origin.some(value => !Number.isFinite(value))) throw new TypeError('grid.origin.invalid');
}

/** Snap a preview point to grid lines. The caller converts a screen-pixel tolerance to icon units. */
export function snapPointToGrid(point: Point, spacing: Point, origin: Point = [0, 0], tolerance = Infinity): GridSnap {
  validate(spacing, origin);
  if (point.some(value => !Number.isFinite(value))) throw new TypeError('grid.point.invalid');
  if (Number.isNaN(tolerance) || tolerance < 0) throw new TypeError('grid.tolerance.invalid');
  const target: Point = [0, 0];
  const snapped: [boolean, boolean] = [false, false];
  for (const axis of [0, 1] as const) {
    const candidate = origin[axis] + Math.round((point[axis] - origin[axis]) / spacing[axis]) * spacing[axis];
    if (!Number.isFinite(candidate)) throw new TypeError('grid.range.invalid');
    snapped[axis] = Math.abs(point[axis] - candidate) <= tolerance;
    target[axis] = snapped[axis] ? candidate : point[axis];
  }
  return { point: target, snappedX: snapped[0], snappedY: snapped[1] };
}

/** Visible line positions for a grid overlay, bounded to avoid excessive DOM nodes. */
export function gridGuides(viewBox: ViewBox, spacing: Point, origin: Point = [0, 0]): GridGuides {
  validate(spacing, origin);
  if (viewBox.some(value => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new TypeError('grid.view-box.invalid');
  }
  const lines = (start: number, size: number, step: number, offset: number): number[] => {
    const first = Math.ceil((start - offset) / step);
    const last = Math.floor((start + size - offset) / step);
    if (!Number.isFinite(first) || !Number.isFinite(last)) throw new TypeError('grid.range.invalid');
    if (last - first + 1 > 4096) throw new TypeError('grid.too-many-guides');
    const result: number[] = [];
    for (let index = first; index <= last; index++) result.push(offset + index * step);
    return result;
  };
  return { vertical: lines(viewBox[0], viewBox[2], spacing[0], origin[0]),
    horizontal: lines(viewBox[1], viewBox[3], spacing[1], origin[1]) };
}
