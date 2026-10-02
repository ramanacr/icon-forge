import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import schemaGenerator from 'ts-json-schema-generator';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';

const root = dirname(fileURLToPath(import.meta.url));
const { createGenerator } = schemaGenerator;
const schema = createGenerator({
  path: join(root, 'src/types.ts'),
  tsconfig: join(root, '../../tsconfig.json'),
  type: 'ProjectV1',
  expose: 'export',
  skipTypeCheck: false,
  strictTuples: true,
  additionalProperties: false,
}).createSchema('ProjectV1');

function toDraft2020(value) {
  if (Array.isArray(value)) return value.map(toDraft2020);
  if (value === null || typeof value !== 'object') return value;
  const converted = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '$schema') converted.$schema = 'https://json-schema.org/draft/2020-12/schema';
    else if (key === 'definitions') converted.$defs = toDraft2020(item);
    else if (key === '$ref') converted.$ref = item.replace('#/definitions/', '#/$defs/');
    else if (key === 'items' && Array.isArray(item)) converted.prefixItems = toDraft2020(item);
    else if (key === 'additionalItems') converted.items = toDraft2020(item);
    else converted[key] = toDraft2020(item);
  }
  return converted;
}

const draft2020 = toDraft2020(schema);
const ajv = new Ajv2020({ code: { source: true, esm: true }, strict: false });
const validate = ajv.compile(draft2020);
const outputs = [
  ['src/project.schema.json', `${JSON.stringify(draft2020, null, 2)}\n`],
  ['src/project.validator.mjs', standaloneCode(ajv, validate)],
];
for (const [name, content] of outputs) {
  const path = join(root, name);
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== content) throw new Error(`${name} is stale; run pnpm schema:generate`);
  } else {
    writeFileSync(path, content);
  }
}
