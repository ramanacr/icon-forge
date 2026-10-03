import { initializeRasterizer, renderSvgToPng } from './index.js';

self.addEventListener('message', event => {
  void (async () => {
    try {
      const wasm = await fetch('/resvg.wasm').then(response => response.arrayBuffer());
      await initializeRasterizer(wasm);
      const results = event.data.sizes.map((size: number) => {
        const start = performance.now();
        const output = renderSvgToPng(event.data.svg, size);
        return { size, png: Array.from(output.png), cornerAlpha: output.pixels[3],
          centerAlpha: output.pixels[((size >> 1) * size + (size >> 1)) * 4 + 3], elapsedMs: performance.now() - start };
      });
      self.postMessage({ results });
    } catch (error) { self.postMessage({ error: String(error) }); }
  })();
});
