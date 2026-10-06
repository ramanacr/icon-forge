import { parseSvgAst } from './safe-ast.js';
import type { ImportLimits } from './xml-reader.js';

self.addEventListener('message', (event: MessageEvent<{ source?: unknown; limits?: Partial<ImportLimits> }>) => {
  const start = performance.now();
  try {
    if (typeof event.data?.source !== 'string') throw new TypeError('import.source-invalid');
    const ast = parseSvgAst(event.data.source, event.data.limits);
    self.postMessage({ ok: true, ast, parseMs: performance.now() - start });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'import.parse-failed' });
  }
});
