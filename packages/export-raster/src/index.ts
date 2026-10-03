import { initWasm, Resvg } from '@resvg/resvg-wasm';

let initialization: Promise<void> | undefined;
let ready = false;

/** Initialize once per worker or Node process with a pinned local WASM asset. */
export function initializeRasterizer(wasm: ArrayBuffer | Uint8Array): Promise<void> {
  if (!initialization) {
    initialization = initWasm(wasm).then(() => { ready = true; }, error => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

export interface RasterResult {
  png: Uint8Array;
  pixels: Uint8Array;
  width: number;
  height: number;
}

export function renderSvgToPng(svg: string, size: number): RasterResult {
  if (!ready) throw new TypeError('rasterizer.not-initialized');
  if (!Number.isInteger(size) || size < 16 || size > 512) throw new TypeError('rasterizer.size.invalid');
  const renderer = new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } });
  try {
    const rendered = renderer.render();
    try {
      return { png: new Uint8Array(rendered.asPng()), pixels: new Uint8Array(rendered.pixels),
        width: rendered.width, height: rendered.height };
    } finally { rendered.free(); }
  } finally { renderer.free(); }
}
