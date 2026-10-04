import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WasmOutlineEngine } from './index.js';

describe('S-03 WASM outline adapter', () => {
  it('turns a canonical open path into a closed filled contour', async () => {
    const wasm = readFileSync(new URL('../../outline-wasm/pkg/iconforge_outline_wasm_bg.wasm', import.meta.url));
    const engine = await WasmOutlineEngine.create(wasm);
    const result = engine.outline([{ start: [2, 4], segments: [{ k: 'L', to: [22, 4] }], closed: false }],
      { width: 4, cap: 'butt', join: 'miter', miterLimit: 4 });
    expect(result.diagnostics).toEqual([]);
    expect(result.path).toHaveLength(1);
    expect(result.path?.[0]?.closed).toBe(true);
    const points = [result.path![0]!.start, ...result.path![0]!.segments.map(segment => segment.to)];
    expect(Math.min(...points.map(point => point[0]))).toBe(2);
    expect(Math.max(...points.map(point => point[1]))).toBe(6);
  });

  it('rejects dashed strokes with the font diagnostic', async () => {
    const wasm = readFileSync(new URL('../../outline-wasm/pkg/iconforge_outline_wasm_bg.wasm', import.meta.url));
    const engine = await WasmOutlineEngine.create(wasm);
    const result = engine.outline([{ start: [2, 4], segments: [{ k: 'L', to: [22, 4] }], closed: false }],
      { width: 4, cap: 'butt', join: 'miter', miterLimit: 4, dash: [2, 2] });
    expect(result.path).toBeNull();
    expect(result.diagnostics).toEqual([{ code: 'font.dash-unsupported', severity: 'error' }]);
  });

  it('unions a filled path with its stroke outline', async () => {
    const wasm = readFileSync(new URL('../../outline-wasm/pkg/iconforge_outline_wasm_bg.wasm', import.meta.url));
    const engine = await WasmOutlineEngine.create(wasm);
    const strokePath = [{ start: [2, 4] as [number, number], segments: [{ k: 'L' as const, to: [22, 4] as [number, number] }], closed: false }];
    const fillPath = [{ start: [8, 4] as [number, number], segments: [
      { k: 'L' as const, to: [16, 4] as [number, number] }, { k: 'L' as const, to: [16, 12] as [number, number] },
      { k: 'L' as const, to: [8, 12] as [number, number] },
    ], closed: true }];
    const result = engine.outline(strokePath, { width: 4, cap: 'butt', join: 'miter', miterLimit: 4 }, fillPath);
    expect(result.path).toHaveLength(1);
    const points = [result.path![0]!.start, ...result.path![0]!.segments.map(segment => segment.to)];
    expect(Math.max(...points.map(point => point[1]))).toBe(12);
  });

  it('reports contours removed below the quantum area', async () => {
    const wasm = readFileSync(new URL('../../outline-wasm/pkg/iconforge_outline_wasm_bg.wasm', import.meta.url));
    const engine = await WasmOutlineEngine.create(wasm);
    const result = engine.outline([{ start: [0, 0], segments: [{ k: 'L', to: [0.01, 0] }], closed: false }],
      { width: 0.01, cap: 'butt', join: 'miter', miterLimit: 4 });
    expect(result.path).toEqual([]);
    expect(result.diagnostics).toEqual([{ code: 'font.degenerate-contour', severity: 'info' }]);
  });
});
