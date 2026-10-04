import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
await build({
  entryPoints: [resolve(here, 'src/main.ts')],
  outfile: process.argv[2] ? resolve(process.argv[2]) : resolve(here, 'dist/iconforge.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
});
