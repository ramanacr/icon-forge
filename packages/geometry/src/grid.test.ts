import { describe, expect, it } from 'vitest';
import { gridGuides, snapPointToGrid } from './grid.js';

describe('ephemeral grid geometry', () => {
  it('snaps each axis to the nearest line within tolerance, including negative coordinates', () => {
    expect(snapPointToGrid([2.9, -2.1], [2, 2], [0, 0], 0.2)).toEqual({ point: [2.9, -2], snappedX: false, snappedY: true });
    expect(snapPointToGrid([-2.9, 4.1], [2, 2], [-1, 0], 0.2)).toEqual({ point: [-3, 4], snappedX: true, snappedY: true });
  });

  it('provides deterministic grid lines for a panned viewBox', () => {
    expect(gridGuides([-1, -2, 5, 4], [2, 2])).toEqual({ vertical: [0, 2, 4], horizontal: [-2, 0, 2] });
    expect(gridGuides([1, 1, 2, 2], [2, 2], [1, 1])).toEqual({ vertical: [1, 3], horizontal: [1, 3] });
  });

  it('rejects invalid or unbounded grids', () => {
    expect(() => snapPointToGrid([0, 0], [0, 1])).toThrow('grid.spacing.invalid');
    expect(() => snapPointToGrid([0, 0], [1, 1], [0, 0], -1)).toThrow('grid.tolerance.invalid');
    expect(() => gridGuides([0, 0, 10000, 1], [1, 1])).toThrow('grid.too-many-guides');
    expect(() => snapPointToGrid([1e308, 0], [1e-308, 1])).toThrow('grid.range.invalid');
    expect(() => gridGuides([1e308, 0, 1, 1], [1e-308, 1])).toThrow('grid.range.invalid');
  });
});
