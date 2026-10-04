import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { WasmOutlineEngine } from '../../packages/outline/src/index.js';

test('S-03 outline WASM matches Node in browser under CSP', async ({ page }) => {
  const wasm = readFileSync(resolve('packages/outline-wasm/pkg/iconforge_outline_wasm_bg.wasm'));
  const path = [{ start: [2, 4] as [number, number], segments: [{ k: 'L' as const, to: [22, 4] as [number, number] }], closed: false }];
  const stroke = { width: 4, cap: 'round' as const, join: 'round' as const, miterLimit: 4 };
  const node = (await WasmOutlineEngine.create(wasm)).outline(path, stroke);
  const bundle = await build({ entryPoints: [resolve('packages/outline/src/index.ts')], bundle: true,
    write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022' });
  expect(gzipSync(wasm).length + gzipSync(bundle.outputFiles[0]!.contents).length).toBeLessThanOrEqual(250 * 1024);
  await page.goto('about:blank');
  await page.setContent('<meta http-equiv="Content-Security-Policy" content="script-src blob: \'wasm-unsafe-eval\'">');
  const browser = await page.evaluate(async ({ code, wasm, path, stroke }) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      const adapter = await import(url) as { WasmOutlineEngine: { create(source: Uint8Array): Promise<{
        outline(paths: typeof path, settings: typeof stroke): unknown }> } };
      return (await adapter.WasmOutlineEngine.create(Uint8Array.from(wasm))).outline(path, stroke);
    } finally { URL.revokeObjectURL(url); }
  }, { code: bundle.outputFiles[0]!.text, wasm: Array.from(wasm), path, stroke });
  expect(browser).toEqual(node);
  expect(node.path).not.toBeNull();
});

test('S-03 typical icon outlining stays below 15 ms p95 in Chromium', async ({ page }) => {
  const wasm = readFileSync(resolve('packages/outline-wasm/pkg/iconforge_outline_wasm_bg.wasm'));
  const bundle = await build({ entryPoints: [resolve('packages/outline/src/index.ts')], bundle: true,
    write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022' });
  await page.goto('about:blank');
  const p95 = await page.evaluate(async ({ code, wasm }) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      const adapter = await import(url) as { WasmOutlineEngine: { create(source: Uint8Array): Promise<{
        outline(paths: unknown[], settings: unknown): unknown }> } };
      const engine = await adapter.WasmOutlineEngine.create(Uint8Array.from(wasm));
      const path = [{ start: [3, 19], segments: [
        { k: 'L', to: [12, 5] }, { k: 'C', c1: [16, 5], c2: [20, 11], to: [21, 19] },
      ], closed: false }];
      const style = { width: 2, cap: 'round', join: 'round', miterLimit: 4 };
      engine.outline(path, style);
      const times = [];
      for (let index = 0; index < 100; index++) {
        const start = performance.now();
        engine.outline(path, style);
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      return times[94];
    } finally { URL.revokeObjectURL(url); }
  }, { code: bundle.outputFiles[0]!.text, wasm: Array.from(wasm) });
  expect(p95).toBeLessThanOrEqual(15);
});

test('S-03 outlined caps and joins match Canvas stroke raster at 96 px', async ({ page }) => {
  const wasm = readFileSync(resolve('packages/outline-wasm/pkg/iconforge_outline_wasm_bg.wasm'));
  const engine = await WasmOutlineEngine.create(wasm);
  const path = [{ start: [3, 19] as [number, number], segments: [
    { k: 'L' as const, to: [12, 5] as [number, number] },
    { k: 'L' as const, to: [21, 19] as [number, number] },
  ], closed: false }];
  for (const cap of ['butt', 'round', 'square'] as const) {
    for (const join of ['miter', 'round', 'bevel'] as const) {
      const result = engine.outline(path, { width: 2, cap, join, miterLimit: 4 });
      expect(result.diagnostics).toEqual([]);
      const iou = await page.evaluate(({ result, cap, join }) => {
        const create = () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96; return canvas; };
        const actual = create(); const expected = create();
        const a = actual.getContext('2d')!; const e = expected.getContext('2d')!;
        a.scale(4, 4); e.scale(4, 4);
        a.beginPath();
        for (const contour of result.path ?? []) {
          a.moveTo(...contour.start);
          for (const segment of contour.segments) a.lineTo(...segment.to);
          a.closePath();
        }
        a.fill();
        e.lineWidth = 2; e.lineCap = cap; e.lineJoin = join; e.miterLimit = 4;
        e.beginPath(); e.moveTo(3, 19); e.lineTo(12, 5); e.lineTo(21, 19); e.stroke();
        const x = a.getImageData(0, 0, 96, 96).data;
        const y = e.getImageData(0, 0, 96, 96).data;
        let intersection = 0; let union = 0;
        for (let index = 3; index < x.length; index += 4) {
          const first = x[index]! > 127; const second = y[index]! > 127;
          if (first && second) intersection++;
          if (first || second) union++;
        }
        return intersection / union;
      }, { result, cap, join });
      expect(iou, `${cap}/${join}`).toBeGreaterThanOrEqual(0.995);
    }
  }
});

test('S-03 closed, reversal, dot and overlap contours match Canvas at 96 px', async ({ page }) => {
  const wasm = readFileSync(resolve('packages/outline-wasm/pkg/iconforge_outline_wasm_bg.wasm'));
  const engine = await WasmOutlineEngine.create(wasm);
  type FixturePath = { start: [number, number]; segments: Array<{ k: 'L'; to: [number, number] }>; closed: boolean };
  const line: FixturePath = { start: [3, 12], segments: [{ k: 'L', to: [21, 12] }], closed: false };
  const fixtures: Array<{ name: string; paths: FixturePath[]; fills?: FixturePath[]; cap: 'butt' | 'round'; join: 'miter' | 'round' }> = [
    { name: 'closed', paths: [{ start: [4, 4], segments: [
      { k: 'L', to: [20, 4] }, { k: 'L', to: [20, 20] }, { k: 'L', to: [4, 20] },
    ], closed: true }], cap: 'butt', join: 'miter' },
    { name: 'reversal', paths: [{ start: [3, 12], segments: [
      { k: 'L', to: [21, 12] }, { k: 'L', to: [3, 12] },
    ], closed: false }], cap: 'round', join: 'round' },
    { name: 'dot', paths: [{ start: [12, 12], segments: [{ k: 'L', to: [12, 12] }], closed: false }], cap: 'round', join: 'round' },
    { name: 'overlap', paths: [line, { start: [12, 3], segments: [{ k: 'L', to: [12, 21] }], closed: false }],
      fills: [{ start: [10, 10], segments: [{ k: 'L', to: [18, 10] }, { k: 'L', to: [18, 18] },
        { k: 'L', to: [10, 18] }], closed: true }], cap: 'round', join: 'round' },
  ];
  for (const fixture of fixtures) {
    const result = engine.outline(fixture.paths, { width: 2, cap: fixture.cap, join: fixture.join, miterLimit: 4 }, fixture.fills);
    expect(result.diagnostics).toEqual([]);
    const iou = await page.evaluate(({ result, fixture }) => {
      const create = () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96; return canvas; };
      const actual = create().getContext('2d')!; const expected = create().getContext('2d')!;
      actual.scale(4, 4); expected.scale(4, 4);
      actual.beginPath();
      for (const contour of result.path ?? []) {
        actual.moveTo(...contour.start);
        for (const segment of contour.segments) actual.lineTo(...segment.to);
        actual.closePath();
      }
      actual.fill();
      if (fixture.fills) {
        expected.beginPath();
        for (const path of fixture.fills) {
          expected.moveTo(...path.start);
          for (const segment of path.segments) expected.lineTo(...segment.to);
          expected.closePath();
        }
        expected.fill();
      }
      expected.lineWidth = 2; expected.lineCap = fixture.cap; expected.lineJoin = fixture.join;
      expected.beginPath();
      for (const path of fixture.paths) {
        expected.moveTo(...path.start);
        for (const segment of path.segments) expected.lineTo(...segment.to);
        if (path.closed) expected.closePath();
      }
      expected.stroke();
      const x = actual.getImageData(0, 0, 96, 96).data;
      const y = expected.getImageData(0, 0, 96, 96).data;
      let intersection = 0; let union = 0;
      for (let index = 3; index < x.length; index += 4) {
        const first = x[index]! > 127; const second = y[index]! > 127;
        if (first && second) intersection++;
        if (first || second) union++;
      }
      return intersection / union;
    }, { result, fixture });
    expect(iou, fixture.name).toBeGreaterThanOrEqual(0.995);
  }
});
