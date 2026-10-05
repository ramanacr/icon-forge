import type { PathDataV1 } from '@iconforge/project-model';
export { iconGeometryBounds, type Bounds } from './bounds.js';
export { gridGuides, snapPointToGrid, type GridGuides, type GridSnap } from './grid.js';

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';
export interface GeometryDiagnostic { code: 'boolean.invalid-input' | 'boolean.unsupported-geometry'; severity: 'error' }
export interface BooleanResult { path: PathDataV1 | null; diagnostics: GeometryDiagnostic[] }
export interface IGeometryEngine { boolean(left: PathDataV1, right: PathDataV1, op: BooleanOp): BooleanResult }
