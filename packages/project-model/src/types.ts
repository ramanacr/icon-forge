/** Persisted v1 document types. SCHEMAS.md is the normative contract. */
export type UUID = string;
export type Slug = string;
export type Coord = number;
export type RuleCode = string;
export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';
export type Severity = 'off' | 'info' | 'warning' | 'error';
export type MatrixV1 = [number, number, number, number, Coord, Coord];

export interface ProjectV1 {
  schemaVersion: '1.0';
  id: UUID;
  name: string;
  revision: number;
  designSystem: DesignSystemV1;
  tokens: ColorTokenV1[];
  components: ComponentV1[];
  icons: IconV1[];
  exportProfiles: ExportProfileV1[];
  provenance: ProvenanceRecordV1[];
  extensions?: Record<string, unknown>;
}

export interface DesignSystemV1 {
  grid: { width: number; height: number };
  safeArea: { top: number; right: number; bottom: number; left: number };
  style: 'outline' | 'filled' | 'duotone' | 'custom';
  stroke: { width: number; cap: LineCap; join: LineJoin; miterLimit: number };
  cornerRadius: number;
  defaultPaintToken: string;
  naming: { pattern: 'kebab'; reserved: string[] };
  severities: Record<RuleCode, Severity>;
}

export interface ColorTokenV1 {
  name: string;
  light: string;
  dark?: string;
}

export interface IconV1 {
  id: UUID;
  name: Slug;
  aliases: Slug[];
  tags: string[];
  category?: string;
  viewBox: [Coord, Coord, Coord, Coord];
  nodes: SceneNodeV1[];
  variants: VariantV1[];
  accessibility: { kind: 'decorative' | 'informative'; label?: string };
  font?: { codepoint?: number; glyphName?: string; ligature?: string; advance?: number; lsb?: number };
  recipeRef?: UUID;
  provenanceIds: UUID[];
  ruleOverrides?: Partial<Record<RuleCode, Severity>>;
}

export interface NodeBaseV1 {
  id: UUID;
  name?: string;
  transform?: MatrixV1;
  visible: boolean;
  locked: boolean;
  opacity?: number;
  role?: 'primary' | 'secondary';
}

export type PaintV1 = { kind: 'none' } | { kind: 'token'; token: string } | { kind: 'color'; value: string };
export interface StrokeV1 { paint: PaintV1; width: Coord; cap: LineCap; join: LineJoin; miterLimit: number; dash?: Coord[] }
export type SegmentV1 =
  | { k: 'L'; to: [Coord, Coord] }
  | { k: 'Q'; c: [Coord, Coord]; to: [Coord, Coord] }
  | { k: 'C'; c1: [Coord, Coord]; c2: [Coord, Coord]; to: [Coord, Coord] };
export interface SubpathV1 { start: [Coord, Coord]; segments: SegmentV1[]; closed: boolean }
export type PathDataV1 = SubpathV1[];
export type ParamValueV1 = number | string | boolean;

export type SceneNodeV1 = NodeBaseV1 & (
  | { type: 'path'; path: PathDataV1; fill?: PaintV1; fillRule: 'nonzero' | 'evenodd'; stroke?: StrokeV1 }
  | { type: 'group'; children: SceneNodeV1[] }
  | { type: 'rect'; x: Coord; y: Coord; width: Coord; height: Coord; rx: Coord; ry: Coord; fill?: PaintV1; stroke?: StrokeV1 }
  | { type: 'ellipse'; cx: Coord; cy: Coord; rx: Coord; ry: Coord; fill?: PaintV1; stroke?: StrokeV1 }
  | { type: 'line'; x1: Coord; y1: Coord; x2: Coord; y2: Coord; stroke: StrokeV1 }
  | { type: 'polyline'; points: Coord[]; closed: boolean; fill?: PaintV1; stroke?: StrokeV1 }
  | { type: 'instance'; componentId: UUID; arguments: Record<string, ParamValueV1> }
);

export interface VariantV1 {
  id: UUID;
  name: Slug;
  dimensions: { style?: 'outline' | 'filled' | 'duotone'; size?: number; state?: string; [custom: `x-${string}`]: string | number | undefined };
  overrides: VariantOverrideV1[];
}
export type VariantOverrideV1 =
  | { op: 'hide'; nodeId: UUID }
  | { op: 'replaceNode'; nodeId: UUID; node: SceneNodeV1 }
  | { op: 'setStroke'; nodeId: UUID; stroke: StrokeV1 | null }
  | { op: 'setFill'; nodeId: UUID; fill: PaintV1 | null }
  | { op: 'setTransform'; nodeId: UUID; transform: MatrixV1 };

export interface ComponentV1 {
  id: UUID;
  name: Slug;
  parameters: { name: string; type: 'number' | 'string' | 'boolean'; default: ParamValueV1; min?: number; max?: number }[];
  nodes: SceneNodeV1[];
}

export type ExportProfileV1 =
  | { id: UUID; name: Slug; target: 'svg'; options: { precision: 0 | 1 | 2 | 3; sizeAttrs: boolean; paintMode: 'currentColor' | 'tokens' | 'resolved'; metadata: boolean } }
  | { id: UUID; name: Slug; target: 'sprite'; options: { idPrefix: string; precision: 0 | 1 | 2 | 3 } }
  | { id: UUID; name: Slug; target: 'png'; options: { sizes: number[]; theme: 'light' | 'dark'; padding: number } }
  | { id: UUID; name: Slug; target: 'ico'; options: { sizes: (16 | 24 | 32 | 48 | 64 | 128 | 256)[]; theme: 'light' | 'dark' } }
  | { id: UUID; name: Slug; target: 'font'; options: { family: string; formats: ('otf' | 'ttf' | 'woff2')[]; unitsPerEm: 1000 | 1024 | 2048; puaStart: number; ligatures: boolean; cssPrefix: string } }
  | { id: UUID; name: Slug; target: 'project'; options: Record<string, never> };

export interface ProvenanceRecordV1 {
  id: UUID;
  source?: string;
  author?: string;
  license?: string;
  attribution?: string;
  originalSha256?: string;
  importedAt?: string;
  modified: boolean;
}
