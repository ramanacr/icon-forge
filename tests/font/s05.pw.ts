import { expect, test } from '@playwright/test';
import { buildOtfFont } from '../../packages/export-font/src/index.js';

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
