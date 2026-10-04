import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOtfFont, buildWoff2Font } from '../../packages/export-font/src/index.js';

test('S-05 WOFF2 loads under CSP and matches Node output', async ({ page }) => {
  const input = { family: 'IconForge Woff2', unitsPerEm: 1000 as const, glyphs: [{
    name: 'square', codepoint: 0xe000, viewBox: [0, 0, 24, 24] as [number, number, number, number],
    path: [{ start: [6, 6] as [number, number], segments: [
      { k: 'L' as const, to: [18, 6] as [number, number] },
      { k: 'L' as const, to: [18, 18] as [number, number] },
      { k: 'L' as const, to: [6, 18] as [number, number] },
    ], closed: true }],
  }] };
  const wasm = readFileSync(resolve('packages/export-font/node_modules/woff2-encode-wasm/dist/encoder.wasm'));
  const nodeBytes = await buildWoff2Font(input, wasm);
  const bundle = await build({ entryPoints: [resolve('packages/export-font/src/index.ts')], bundle: true,
    write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022' });
  await page.goto('about:blank');
  await page.setContent('<meta http-equiv="Content-Security-Policy" content="script-src blob: \'wasm-unsafe-eval\'; font-src blob:">');
  const browser = await page.evaluate(async ({ code, input, wasm }) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      const compiler = await import(url) as { buildWoff2Font(value: typeof input, source: Uint8Array): Promise<Uint8Array>;
        buildOtfFont(value: typeof input): Uint8Array };
      const bytes = await compiler.buildWoff2Font(input, Uint8Array.from(wasm));
      const face = new FontFace('IconForge Woff2', new Uint8Array(bytes));
      await face.load();
      document.fonts.add(face);
      const fontCanvas = document.createElement('canvas'); fontCanvas.width = fontCanvas.height = 48;
      const fontContext = fontCanvas.getContext('2d')!;
      fontContext.font = '48px "IconForge Woff2"'; fontContext.textBaseline = 'alphabetic';
      fontContext.fillText('\ue000', 0, 38.4);
      const reference = document.createElement('canvas'); reference.width = reference.height = 48;
      reference.getContext('2d')!.fillRect(12, 12, 24, 24);
      const actual = fontContext.getImageData(0, 0, 48, 48).data;
      const expected = reference.getContext('2d')!.getImageData(0, 0, 48, 48).data;
      const otfFace = new FontFace('IconForge Otf Ref', new Uint8Array(compiler.buildOtfFont(input)));
      await otfFace.load(); document.fonts.add(otfFace);
      const otfCanvas = document.createElement('canvas'); otfCanvas.width = otfCanvas.height = 48;
      const otfContext = otfCanvas.getContext('2d')!;
      otfContext.font = '48px "IconForge Otf Ref"'; otfContext.textBaseline = 'alphabetic';
      otfContext.fillText('\ue000', 0, 38.4);
      const otf = otfContext.getImageData(0, 0, 48, 48).data;
      let intersection = 0; let union = 0;
      let codecIntersection = 0; let codecUnion = 0;
      for (let index = 3; index < actual.length; index += 4) {
        const a = actual[index]! > 127; const b = expected[index]! > 127;
        const c = otf[index]! > 127;
        if (a && b) intersection++;
        if (a || b) union++;
        if (a && c) codecIntersection++;
        if (a || c) codecUnion++;
      }
      return { bytes: Array.from(bytes), status: face.status, iou: intersection / union,
        codecIou: codecIntersection / codecUnion };
    } finally { URL.revokeObjectURL(url); }
  }, { code: bundle.outputFiles[0]!.text, input, wasm: Array.from(wasm) });
  expect(browser.bytes).toEqual(Array.from(nodeBytes));
  expect(browser.status).toBe('loaded');
  expect(browser.codecIou).toBe(1);
  expect(browser.iou).toBeGreaterThanOrEqual(0.98);
});

test('S-05 200 glyph OTF and WOFF2 build stays within 3 seconds', async ({ page }) => {
  const wasm = readFileSync(resolve('packages/export-font/node_modules/woff2-encode-wasm/dist/encoder.wasm'));
  const glyphs = Array.from({ length: 200 }, (_, index) => ({
    name: `icon-${index}`, codepoint: 0xe000 + index, viewBox: [0, 0, 24, 24],
    path: [{ start: [6, 6], segments: [
      { k: 'L', to: [18, 6] }, { k: 'L', to: [18, 18] }, { k: 'L', to: [6, 18] },
    ], closed: true }],
  }));
  const bundle = await build({ entryPoints: [resolve('packages/export-font/src/index.ts')], bundle: true,
    write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022' });
  await page.goto('about:blank');
  const result = await page.evaluate(async ({ code, wasm, glyphs }) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      const compiler = await import(url) as { buildWoff2Font(value: unknown, source: Uint8Array): Promise<Uint8Array> };
      const start = performance.now();
      const bytes = await compiler.buildWoff2Font({ family: 'IconForge Scale', unitsPerEm: 1000, glyphs }, Uint8Array.from(wasm));
      return { elapsed: performance.now() - start, signature: String.fromCharCode(...bytes.subarray(0, 4)) };
    } finally { URL.revokeObjectURL(url); }
  }, { code: bundle.outputFiles[0]!.text, wasm: Array.from(wasm), glyphs });
  expect(result.signature).toBe('wOF2');
  expect(result.elapsed).toBeLessThanOrEqual(3000);
});

test('S-05 browser font construction matches Node byte for byte', async ({ page }) => {
  const input = { family: 'IconForge Medical', unitsPerEm: 1000 as const, ligatures: true, glyphs: [{
    name: 'medical-plus', codepoint: 0xe000, ligature: 'plus', viewBox: [0, 0, 24, 24] as [number, number, number, number],
    path: [{ start: [6, 6] as [number, number], segments: [
      { k: 'L' as const, to: [18, 6] as [number, number] }, { k: 'L' as const, to: [18, 18] as [number, number] },
      { k: 'L' as const, to: [6, 18] as [number, number] },
    ], closed: true }],
  }] };
  const nodeBytes = buildOtfFont(input);
  const bundle = await build({ entryPoints: [resolve('packages/export-font/src/index.ts')], bundle: true,
    write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022' });
  await page.goto('about:blank');
  const browserBytes = await page.evaluate(async ({ code, input }) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      const compiler = await import(url) as { buildOtfFont(value: typeof input): Uint8Array };
      return Array.from(compiler.buildOtfFont(input));
    } finally { URL.revokeObjectURL(url); }
  }, { code: bundle.outputFiles[0]!.text, input });
  expect(browserBytes).toEqual(Array.from(nodeBytes));
});

test('S-05 CFF font loads with FontFace and glyph matches filled SVG shape', async ({ page }) => {
  const font = buildOtfFont({ family: 'IconForge Medical', unitsPerEm: 1000, glyphs: [{
    name: 'medical-plus', codepoint: 0xe000, viewBox: [0, 0, 24, 24],
    path: [{ start: [6, 6], segments: [{ k: 'L', to: [18, 6] }, { k: 'L', to: [18, 18] },
      { k: 'L', to: [6, 18] }], closed: true }],
  }] });
  await page.goto('about:blank');
  const result = await page.evaluate(async bytes => {
    const face = new FontFace('IconForge Medical', Uint8Array.from(bytes));
    await face.load();
    document.fonts.add(face);
    const fontCanvas = document.createElement('canvas');
    fontCanvas.width = fontCanvas.height = 48;
    const fontContext = fontCanvas.getContext('2d')!;
    fontContext.font = '48px "IconForge Medical"';
    fontContext.textBaseline = 'alphabetic';
    fontContext.fillText('\ue000', 0, 38.4);
    const reference = document.createElement('canvas');
    reference.width = reference.height = 48;
    const referenceContext = reference.getContext('2d')!;
    referenceContext.fillRect(12, 12, 24, 24);
    const first = fontContext.getImageData(0, 0, 48, 48).data;
    const second = referenceContext.getImageData(0, 0, 48, 48).data;
    let intersection = 0;
    let union = 0;
    for (let index = 3; index < first.length; index += 4) {
      const fontPixel = first[index]! > 127;
      const referencePixel = second[index]! > 127;
      if (fontPixel && referencePixel) intersection++;
      if (fontPixel || referencePixel) union++;
    }
    return { status: face.status, iou: union === 0 ? 0 : intersection / union };
  }, Array.from(font));
  expect(result.status).toBe('loaded');
  expect(result.iou).toBeGreaterThanOrEqual(0.98);
});

test('S-05 opposite-winding contours preserve a nested glyph hole', async ({ page }) => {
  const font = buildOtfFont({ family: 'IconForge Rings', unitsPerEm: 1000, glyphs: [{
    name: 'ring', codepoint: 0xe001, viewBox: [0, 0, 24, 24], path: [
      { start: [2, 2], segments: [{ k: 'L', to: [22, 2] }, { k: 'L', to: [22, 22] },
        { k: 'L', to: [2, 22] }], closed: true },
      { start: [8, 8], segments: [{ k: 'L', to: [8, 16] }, { k: 'L', to: [16, 16] },
        { k: 'L', to: [16, 8] }], closed: true },
    ],
  }] });
  await page.goto('about:blank');
  const result = await page.evaluate(async bytes => {
    const face = new FontFace('IconForge Rings', Uint8Array.from(bytes));
    await face.load(); document.fonts.add(face);
    const fontCanvas = document.createElement('canvas'); fontCanvas.width = fontCanvas.height = 48;
    const context = fontCanvas.getContext('2d')!;
    context.font = '48px "IconForge Rings"'; context.textBaseline = 'alphabetic';
    context.fillText('\ue001', 0, 38.4);
    const reference = document.createElement('canvas'); reference.width = reference.height = 48;
    const expected = reference.getContext('2d')!;
    expected.fillRect(4, 4, 40, 40); expected.clearRect(16, 16, 16, 16);
    const actualPixels = context.getImageData(0, 0, 48, 48).data;
    const expectedPixels = expected.getImageData(0, 0, 48, 48).data;
    let intersection = 0; let union = 0;
    for (let index = 3; index < actualPixels.length; index += 4) {
      const actual = actualPixels[index]! > 127;
      const reference = expectedPixels[index]! > 127;
      if (actual && reference) intersection++;
      if (actual || reference) union++;
    }
    return { status: face.status, iou: intersection / union, holeAlpha: actualPixels[(24 * 48 + 24) * 4 + 3] };
  }, Array.from(font));
  expect(result.status).toBe('loaded');
  expect(result.holeAlpha).toBe(0);
  expect(result.iou).toBeGreaterThanOrEqual(0.98);
});

test('S-05 FontFace shapes ligature text to its PUA icon glyph', async ({ page }) => {
  const font = buildOtfFont({ family: 'IconForge Ligatures', unitsPerEm: 1000, ligatures: true, glyphs: [{
    name: 'plus', codepoint: 0xe000, ligature: 'plus', viewBox: [0, 0, 24, 24],
    path: [{ start: [6, 6], segments: [{ k: 'L', to: [18, 6] }, { k: 'L', to: [18, 18] },
      { k: 'L', to: [6, 18] }], closed: true }],
  }] });
  await page.goto('about:blank');
  const result = await page.evaluate(async bytes => {
    const face = new FontFace('IconForge Ligatures', Uint8Array.from(bytes));
    await face.load(); document.fonts.add(face);
    const render = (text: string): Uint8ClampedArray => {
      const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 48;
      const context = canvas.getContext('2d')!;
      context.font = '48px "IconForge Ligatures"'; context.textBaseline = 'alphabetic';
      context.fillText(text, 0, 38.4);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const pua = render('\ue000');
    const ligature = render('plus');
    let intersection = 0; let union = 0;
    for (let index = 3; index < pua.length; index += 4) {
      const a = pua[index]! > 127; const b = ligature[index]! > 127;
      if (a && b) intersection++;
      if (a || b) union++;
    }
    return { status: face.status, iou: union === 0 ? 0 : intersection / union };
  }, Array.from(font));
  expect(result.status).toBe('loaded');
  expect(result.iou).toBeGreaterThanOrEqual(0.98);
});
