import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const allowed = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause',
  'Apache-2.0', '0BSD', 'CC0-1.0']);
const isWindows = process.platform === 'win32';
const source = process.argv[2]
  ? readFileSync(process.argv[2], 'utf8')
  : execFileSync(isWindows ? 'pnpm.cmd' : 'pnpm', ['licenses', 'list', '--prod', '--json'],
    { encoding: 'utf8', shell: isWindows });
const report = JSON.parse(source);
if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('Invalid licence report');

let count = 0;
const rejected = [];
for (const [license, packages] of Object.entries(report)) {
  if (!Array.isArray(packages)) throw new Error(`Invalid licence entries for ${license}`);
  for (const item of packages) {
    if (!item || typeof item.name !== 'string' || !Array.isArray(item.versions)) {
      throw new Error(`Invalid package entry for ${license}`);
    }
    count++;
    if (!allowed.has(license) && !(license === 'MPL-2.0' && item.name === '@resvg/resvg-wasm')) {
      rejected.push(`${item.name}@${item.versions.join(',')} (${license})`);
    }
  }
}
if (count === 0) throw new Error('Production licence report is empty');
if (rejected.length) throw new Error(`Production dependency licences need review:\n${rejected.join('\n')}`);
process.stdout.write(`Production licence policy passed for ${count} packages\n`);
