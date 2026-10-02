import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { generateSchema } from '../../scripts/schema-tools.mjs';

generateSchema({
  root: dirname(fileURLToPath(import.meta.url)),
  source: 'src/project.ts', type: 'ProjectCommand', name: 'command',
  check: process.argv.includes('--check'),
});
