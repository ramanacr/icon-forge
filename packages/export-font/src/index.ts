import * as opentype from 'opentype.js';
import type { WasmSource } from 'woff2-encode-wasm';
import { quantize } from '@iconforge/project-model';

export interface FilledFontGlyph {
  name: string;
  codepoint: number;
  ligature?: string;
  advance?: number;
  lsb?: number;
  viewBox: [number, number, number, number];
  path: Array<{ start: [number, number]; segments: Array<
    | { k: 'L'; to: [number, number] }
    | { k: 'Q'; c: [number, number]; to: [number, number] }
    | { k: 'C'; c1: [number, number]; c2: [number, number]; to: [number, number] }
  >; closed: boolean }>;
}

export interface OtfFontInput {
  family: string;
  unitsPerEm: 1000 | 1024 | 2048;
  ligatures?: boolean;
  glyphs: FilledFontGlyph[];
}

const FIXED_MAC_TIMESTAMP = 2_082_844_800n;

function checksum(bytes: Uint8Array, start: number, length: number): number {
  let total = 0;
  for (let index = 0; index < length; index += 4) {
    const word = ((bytes[start + index] ?? 0) << 24) | ((bytes[start + index + 1] ?? 0) << 16)
      | ((bytes[start + index + 2] ?? 0) << 8) | (bytes[start + index + 3] ?? 0);
    total = (total + (word >>> 0)) >>> 0;
  }
  return total;
}

function fixTimestamps(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4);
  let record = -1;
  for (let index = 0; index < count; index++) {
    const offset = 12 + index * 16;
    if (String.fromCharCode(...bytes.slice(offset, offset + 4)) === 'head') { record = offset; break; }
  }
  if (record < 0) throw new TypeError('font.head.missing');
  const headOffset = view.getUint32(record + 8);
  const headLength = view.getUint32(record + 12);
  if (headOffset + headLength > bytes.length || headLength < 36) throw new TypeError('font.head.invalid');
  view.setUint32(headOffset + 8, 0);
  view.setBigUint64(headOffset + 20, FIXED_MAC_TIMESTAMP);
  view.setBigUint64(headOffset + 28, FIXED_MAC_TIMESTAMP);
  view.setUint32(record + 4, checksum(bytes, headOffset, headLength));
  view.setUint32(headOffset + 8, (0xB1B0AFBA - checksum(bytes, 0, bytes.length)) >>> 0);
}

/** Build a deterministic CFF-flavoured OpenType font from filled canonical outlines. */
export function buildOtfFont(input: OtfFontInput): Uint8Array {
  const family = input.family.replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 31);
  if (!family || input.glyphs.length === 0) throw new TypeError('font.input.invalid');
  const ascender = quantize(input.unitsPerEm * 0.8, 0);
  const seenCodepoints = new Set<number>();
  const seenNames = new Set<string>();
  const glyphs: opentype.Glyph[] = [];
  const missing = new opentype.Path();
  missing.moveTo(0, 0); missing.lineTo(input.unitsPerEm, 0);
  missing.lineTo(input.unitsPerEm, ascender); missing.lineTo(0, ascender); missing.closePath();
  glyphs.push(new opentype.Glyph({ name: '.notdef', advanceWidth: input.unitsPerEm, path: missing }));
  glyphs.push(new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: input.unitsPerEm, path: new opentype.Path() }));
  const inputGlyphIds = new Map<number, number>([[32, 1]]);
  if (input.ligatures) {
    const inputCodepoints = new Set<number>();
    for (const glyph of input.glyphs) {
      if (glyph.ligature !== undefined) {
        if (!/^[A-Za-z0-9_-]{2,64}$/.test(glyph.ligature)) throw new TypeError('font.ligature.invalid');
        for (const character of glyph.ligature) inputCodepoints.add(character.codePointAt(0)!);
      }
    }
    for (const codepoint of [...inputCodepoints].sort((a, b) => a - b)) {
      if (codepoint === 32) continue;
      inputGlyphIds.set(codepoint, glyphs.length);
      glyphs.push(new opentype.Glyph({ name: `uni${codepoint.toString(16).toUpperCase().padStart(4, '0')}`,
        unicode: codepoint, advanceWidth: 0, path: new opentype.Path() }));
    }
  }
  const iconGlyphIds = new Map<string, number>();
  for (const glyph of [...input.glyphs].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (!Number.isInteger(glyph.codepoint) || glyph.codepoint < 0xe000 || glyph.codepoint > 0x10fffd
      || seenCodepoints.has(glyph.codepoint) || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(glyph.name) || seenNames.has(glyph.name)) {
      throw new TypeError('font.glyph.invalid');
    }
    seenCodepoints.add(glyph.codepoint); seenNames.add(glyph.name);
    const [vx, vy, vw, vh] = glyph.viewBox;
    if (vw <= 0 || vh <= 0) throw new TypeError('font.viewBox.invalid');
    const point = ([x, y]: [number, number]): [number, number] => [
      quantize(((x - vx) * input.unitsPerEm) / vw),
      quantize(ascender - ((y - vy) * input.unitsPerEm) / vh),
    ];
    const path = new opentype.Path();
    for (const subpath of glyph.path) {
      if (!subpath.closed || subpath.segments.length === 0) throw new TypeError('font.open-path');
      const [startX, startY] = point(subpath.start);
      path.moveTo(startX, startY);
      let current = [startX, startY] as [number, number];
      for (const segment of subpath.segments) {
        const to = point(segment.to);
        if (segment.k === 'L') path.lineTo(...to);
        else if (segment.k === 'C') path.bezierCurveTo(...point(segment.c1), ...point(segment.c2), ...to);
        else {
          const control = point(segment.c);
          path.bezierCurveTo(quantize(current[0] + (2 / 3) * (control[0] - current[0])),
            quantize(current[1] + (2 / 3) * (control[1] - current[1])),
            quantize(to[0] + (2 / 3) * (control[0] - to[0])), quantize(to[1] + (2 / 3) * (control[1] - to[1])), ...to);
        }
        current = to;
      }
      path.closePath();
    }
    if ((glyph.advance !== undefined && !Number.isFinite(glyph.advance))
      || (glyph.lsb !== undefined && !Number.isFinite(glyph.lsb))) throw new TypeError('font.metrics.invalid');
    const advance = glyph.advance === undefined ? input.unitsPerEm : quantize(glyph.advance, 0);
    const lsb = glyph.lsb === undefined
      ? path.commands.length === 0 ? 0 : quantize(path.getBoundingBox().x1, 0)
      : quantize(glyph.lsb, 0);
    if (advance <= 0 || advance > 65535 || lsb < -32768 || lsb > 32767) throw new TypeError('font.metrics.invalid');
    if (glyph.lsb !== undefined && path.commands.length > 0) {
      const shift = lsb - path.getBoundingBox().x1;
      for (const command of path.commands) {
        if ('x' in command) command.x = quantize(command.x + shift);
        if ('x1' in command) command.x1 = quantize(command.x1 + shift);
        if ('x2' in command) command.x2 = quantize(command.x2 + shift);
      }
    }
    iconGlyphIds.set(glyph.name, glyphs.length);
    const compiled = new opentype.Glyph({ name: glyph.name, unicode: glyph.codepoint,
      advanceWidth: advance, path });
    // opentype.js 1.3.4 declares this constructor option but does not bind it.
    compiled.leftSideBearing = lsb;
    glyphs.push(compiled);
  }
  const font = new opentype.Font({ familyName: family, styleName: 'Regular', unitsPerEm: input.unitsPerEm,
    ascender, descender: ascender - input.unitsPerEm, glyphs, createdTimestamp: 1 });
  if (input.ligatures) {
    const substitution = font.substitution as unknown as { addLigature(feature: string, ligature: { sub: number[]; by: number }, script?: string): void };
    for (const glyph of input.glyphs) {
      if (!glyph.ligature) continue;
      const sub = [...glyph.ligature].map(character => inputGlyphIds.get(character.codePointAt(0)!)!);
      substitution.addLigature('liga', { sub, by: iconGlyphIds.get(glyph.name)! });
      substitution.addLigature('liga', { sub, by: iconGlyphIds.get(glyph.name)! }, 'latn');
    }
  }
  const bytes = new Uint8Array(font.toArrayBuffer());
  fixTimestamps(bytes);
  return bytes;
}

/** Encode the deterministic CFF font as WOFF2 using a caller-provided WASM asset. */
export async function buildWoff2Font(input: OtfFontInput, wasmSource: WasmSource): Promise<Uint8Array> {
  const { init, encode } = await import('woff2-encode-wasm');
  await init(wasmSource);
  return encode(buildOtfFont(input));
}
