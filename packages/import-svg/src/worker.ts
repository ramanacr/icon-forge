import { parseSvgAst } from './safe-ast.js';
import { canonicalizeSvgAst } from './canonicalize.js';
import type { ImportLimits } from './xml-reader.js';

function uuidV7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = Date.now();
  for (let index = 5; index >= 0; index--) {
    bytes[index] = timestamp & 0xff;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

self.addEventListener('message', async (event: MessageEvent<{ kind?: string; source?: unknown;
  limits?: Partial<ImportLimits>; bytes?: unknown; iconId?: string; provenanceId?: string; name?: string }>) => {
  const start = performance.now();
  try {
    if (event.data?.kind === 'prepare') {
      if (!(event.data.bytes instanceof Uint8Array) || event.data.bytes.length > 2 * 1024 * 1024
        || typeof event.data.iconId !== 'string' || typeof event.data.provenanceId !== 'string'
        || typeof event.data.name !== 'string') throw new TypeError('import.source-invalid');
      const source = new TextDecoder('utf-8', { fatal: true }).decode(event.data.bytes);
      const ast = parseSvgAst(source);
      const canonical = canonicalizeSvgAst(ast, { iconId: event.data.iconId,
        provenanceId: event.data.provenanceId, name: event.data.name, nextNodeId: uuidV7 });
      const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(event.data.bytes));
      const originalSha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      self.postMessage({ ok: true, result: { ...canonical, provenance: {
        id: event.data.provenanceId, originalSha256, license: 'UNKNOWN', modified: false,
      } } });
    } else {
      if (typeof event.data?.source !== 'string') throw new TypeError('import.source-invalid');
      const ast = parseSvgAst(event.data.source, event.data.limits);
      self.postMessage({ ok: true, result: ast, parseMs: performance.now() - start,
        ast });
    }
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'import.parse-failed' });
  }
});
