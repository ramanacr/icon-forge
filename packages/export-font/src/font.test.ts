import { describe, expect, it } from 'vitest';
import * as fontkit from 'fontkit';
import { buildOtfFont } from './index.js';

const input = { family: 'IconForge Medical', unitsPerEm: 1000 as const, glyphs: [{
  name: 'medical-plus', codepoint: 0xe000, viewBox: [0, 0, 24, 24] as [number, number, number, number],
  path: [{ start: [6, 6] as [number, number], segments: [
    { k: 'L' as const, to: [18, 6] as [number, number] },
    { k: 'L' as const, to: [18, 18] as [number, number] },
    { k: 'L' as const, to: [6, 18] as [number, number] },
  ], closed: true }],
}] };

describe('S-05 OTF/CFF font construction', () => {
  it('writes deterministic CFF bytes with .notdef, space and a PUA glyph', () => {
    const first = buildOtfFont(input);
    const second = buildOtfFont(input);
    expect(first).toEqual(second);
    expect(String.fromCharCode(...first.slice(0, 4))).toBe('OTTO');
    const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
    const tableCount = view.getUint16(4);
    let headOffset = -1;
    for (let index = 0; index < tableCount; index++) {
      const record = 12 + index * 16;
      if (String.fromCharCode(...first.slice(record, record + 4)) === 'head') headOffset = view.getUint32(record + 8);
    }
    expect(headOffset).toBeGreaterThan(0);
    expect(view.getBigUint64(headOffset + 20)).toBe(2_082_844_800n);
    expect(view.getBigUint64(headOffset + 28)).toBe(2_082_844_800n);
    const parsed = fontkit.create(Buffer.from(first));
    if ('fonts' in parsed) throw new Error('Expected a single OTF font');
    expect(parsed.unitsPerEm).toBe(1000);
    expect(parsed.postscriptName).toContain('IconForge');
    expect(parsed.glyphForCodePoint(0x20).id).toBe(1);
    expect(parsed.glyphForCodePoint(0xe000).id).toBe(2);
    expect(parsed.glyphForCodePoint(0xe000).path.commands.length).toBeGreaterThan(3);
  });

  it('includes input glyphs and a GSUB ligature when enabled', () => {
    const bytes = buildOtfFont({ ...input, ligatures: true,
      glyphs: [{ ...input.glyphs[0]!, ligature: 'plus' }] });
    const parsed = fontkit.create(Buffer.from(bytes));
    if ('fonts' in parsed) throw new Error('Expected a single OTF font');
    for (const character of 'plus') expect(parsed.glyphForCodePoint(character.codePointAt(0)!).id).toBeGreaterThan(0);
    const shaped = parsed.layout('plus');
    expect(shaped.glyphs).toHaveLength(1);
    expect(shaped.glyphs[0]?.id).toBe(parsed.glyphForCodePoint(0xe000).id);
  });

  it('preserves explicit PUA mappings across insertion order and empty glyphs', () => {
    const empty = { name: 'empty', codepoint: 0xe001, viewBox: [0, 0, 24, 24] as [number, number, number, number],
      path: [] };
    const a = buildOtfFont({ ...input, glyphs: [input.glyphs[0]!, empty] });
    const b = buildOtfFont({ ...input, glyphs: [empty, input.glyphs[0]!] });
    expect(a).toEqual(b);
    const parsed = fontkit.create(Buffer.from(a));
    if ('fonts' in parsed) throw new Error('Expected a single OTF font');
    expect(parsed.glyphForCodePoint(0xe000).name).toBe('medical-plus');
    expect(parsed.glyphForCodePoint(0xe001).name).toBe('empty');
    expect(parsed.glyphForCodePoint(0xe001).path.commands).toHaveLength(0);
    const original = fontkit.create(Buffer.from(buildOtfFont(input)));
    if ('fonts' in original) throw new Error('Expected a single OTF font');
    expect(original.glyphForCodePoint(0xe000).name).toBe(parsed.glyphForCodePoint(0xe000).name);
  });

  it('rejects duplicate codepoints and sanitizes the family name', () => {
    expect(() => buildOtfFont({ ...input, glyphs: [input.glyphs[0]!,
      { ...input.glyphs[0]!, name: 'other', codepoint: 0xe000 }] })).toThrow('font.glyph.invalid');
    expect(() => buildOtfFont({ ...input, family: '!!!' })).toThrow('font.input.invalid');
    const parsed = fontkit.create(Buffer.from(buildOtfFont({ ...input, family: 'Medical!? Icons' })));
    if ('fonts' in parsed) throw new Error('Expected a single OTF font');
    expect(parsed.familyName).toBe('Medical Icons');
  });

  it('writes explicit advances and bearings that agree with outline bounds', () => {
    const bytes = buildOtfFont({ ...input, glyphs: [{ ...input.glyphs[0]!, advance: 1200, lsb: -200 }] });
    const parsed = fontkit.create(Buffer.from(bytes));
    if ('fonts' in parsed) throw new Error('Expected a single OTF font');
    const glyph = parsed.glyphForCodePoint(0xe000);
    expect(glyph.advanceWidth).toBe(1200);
    expect(glyph.bbox.minX).toBeCloseTo(-200, 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let hmtxOffset = -1;
    for (let index = 0; index < view.getUint16(4); index++) {
      const record = 12 + index * 16;
      if (String.fromCharCode(...bytes.slice(record, record + 4)) === 'hmtx') hmtxOffset = view.getUint32(record + 8);
    }
    expect(hmtxOffset).toBeGreaterThan(0);
    expect(view.getInt16(hmtxOffset + glyph.id * 4 + 2)).toBe(-200);
    expect(() => buildOtfFont({ ...input, glyphs: [{ ...input.glyphs[0]!, advance: 70_000 }] }))
      .toThrow('font.metrics.invalid');
  });
});
