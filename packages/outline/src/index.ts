import { quantize, type PathDataV1, type StrokeV1 } from '@iconforge/project-model';

export type OutlineStroke = Omit<StrokeV1, 'paint'>;
export interface OutlineDiagnostic { code: string; severity: 'error' | 'info' }
export interface OutlineResult { path: PathDataV1 | null; diagnostics: OutlineDiagnostic[] }
export interface IOutlineEngine {
  outline(path: PathDataV1, stroke: OutlineStroke, fills?: PathDataV1,
    fillRule?: 'nonzero' | 'evenodd'): OutlineResult;
}

/** Browser and Node adapter for the pinned Rust outline WASM. */
export class WasmOutlineEngine implements IOutlineEngine {
  private constructor(private readonly outlineJson: (request: string) => string) {}

  static async create(wasmSource: Uint8Array): Promise<WasmOutlineEngine> {
    const { default: initWasm, outline_json } = await import('@iconforge/outline-wasm');
    await initWasm({ module_or_path: new Uint8Array(wasmSource) });
    return new WasmOutlineEngine(outline_json);
  }

  outline(path: PathDataV1, stroke: OutlineStroke, fills: PathDataV1 = [],
    fillRule: 'nonzero' | 'evenodd' = 'nonzero'): OutlineResult {
    const result = JSON.parse(this.outlineJson(JSON.stringify({ paths: path, fills, fill_rule: fillRule, stroke: {
      width: stroke.width, cap: stroke.cap, join: stroke.join,
      miter_limit: stroke.miterLimit, dash: stroke.dash ?? [],
    } }))) as { error?: string; path?: Array<Array<[number, number]>>; diagnostics?: OutlineDiagnostic[] };
    if (result.error) return { path: null, diagnostics: [{ code: result.error, severity: 'error' }] };
    if (!result.path) return { path: null, diagnostics: [{ code: 'outline.invalid-output', severity: 'error' }] };
    const contours: PathDataV1 = result.path.filter(contour => contour.length >= 3).map(contour => ({
      start: [quantize(contour[0]![0]), quantize(contour[0]![1])],
      segments: contour.slice(1).map(point => ({ k: 'L' as const,
        to: [quantize(point[0]), quantize(point[1])] as [number, number] })),
      closed: true,
    }));
    return { path: contours, diagnostics: result.diagnostics ?? [] };
  }
}
