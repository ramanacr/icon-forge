import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(process.argv[2] ?? 'dist/web/browser');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');

function assets(tag, attribute) {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))]
    .map(([element]) => element.match(new RegExp(`\\b${attribute}="([^"]+)"`, 'i'))?.[1])
    .filter(Boolean);
}

const scripts = assets('script', 'src');
const styles = [...html.matchAll(/<link\b[^>]*>/gi)]
  .filter(([element]) => /\brel="stylesheet"/i.test(element))
  .map(([element]) => element.match(/\bhref="([^"]+)"/i)?.[1])
  .filter(Boolean);

if (!scripts.length || !styles.length) throw new Error('Built index is missing shell JS or CSS assets');

function compressedBytes(files) {
  return files.reduce((total, file) => {
    if (!/^[A-Za-z0-9._/-]+$/.test(file) || file.startsWith('/')) throw new Error(`Invalid shell asset: ${file}`);
    const path = resolve(root, file);
    if (!path.startsWith(`${root}${sep}`)) throw new Error(`Shell asset escapes build directory: ${file}`);
    return total + gzipSync(readFileSync(path)).byteLength;
  }, 0);
}

for (const [label, files, limit] of [['JS', scripts, 500], ['CSS', styles, 60]]) {
  const bytes = compressedBytes(files);
  const kib = (bytes / 1024).toFixed(2);
  process.stdout.write(`Initial shell ${label}: ${kib} KiB gzip / ${limit} KiB budget\n`);
  if (bytes > limit * 1024) throw new Error(`Initial shell ${label} exceeds its compressed budget`);
}

// The current web build contains only the editor runtime outside the initial shell.
const lazyScripts = readdirSync(root).filter(file => file.endsWith('.js') && !scripts.includes(file));
const lazyBytes = compressedBytes(lazyScripts);
process.stdout.write(`Editor lazy JS: ${(lazyBytes / 1024).toFixed(2)} KiB gzip / 350 KiB budget\n`);
if (lazyBytes > 350 * 1024) throw new Error('Editor lazy JS exceeds its compressed budget');
