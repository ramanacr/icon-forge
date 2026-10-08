import nx from '@nx/eslint-plugin';
import parser from '@typescript-eslint/parser';

export default [
  {
    files: ['packages/**/*.ts', 'apps/**/*.ts'],
    ignores: ['**/*.d.ts'],
    languageOptions: { parser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
    plugins: { '@nx': nx },
    rules: {
      '@nx/enforce-module-boundaries': ['error', {
        enforceBuildableLibDependency: false,
        allow: [],
        depConstraints: [
          { sourceTag: 'layer:model', onlyDependOnLibsWithTags: ['layer:model'] },
          { sourceTag: 'layer:commands', onlyDependOnLibsWithTags: ['layer:model', 'layer:geometry', 'layer:commands'] },
          { sourceTag: 'layer:application', onlyDependOnLibsWithTags: ['layer:model', 'layer:commands', 'layer:application'] },
          { sourceTag: 'layer:export-svg', onlyDependOnLibsWithTags: ['layer:model', 'layer:export-svg'] },
          { sourceTag: 'layer:compiler-core', onlyDependOnLibsWithTags: ['layer:model', 'layer:export-svg', 'layer:compiler-core'] },
          { sourceTag: 'layer:editor-core', onlyDependOnLibsWithTags: ['layer:model', 'layer:commands', 'layer:application', 'layer:editor-core'] },
          { sourceTag: 'layer:cli', onlyDependOnLibsWithTags: ['layer:model', 'layer:compiler-core', 'layer:persistence', 'layer:cli'] },
          { sourceTag: 'layer:geometry', onlyDependOnLibsWithTags: ['layer:model', 'layer:geometry'] },
          { sourceTag: 'layer:rules', onlyDependOnLibsWithTags: ['layer:model', 'layer:rules'] },
          { sourceTag: 'layer:web', onlyDependOnLibsWithTags: ['layer:model', 'layer:commands', 'layer:application', 'layer:editor-core', 'layer:geometry', 'layer:persistence', 'layer:compiler-core', 'layer:rules', 'layer:web'] },
          { sourceTag: 'layer:geometry-paper', onlyDependOnLibsWithTags: ['layer:model', 'layer:geometry', 'layer:geometry-paper'] },
          { sourceTag: 'layer:outline', onlyDependOnLibsWithTags: ['layer:model', 'layer:outline-wasm', 'layer:outline'] },
          { sourceTag: 'layer:outline-wasm', onlyDependOnLibsWithTags: ['layer:outline-wasm'] },
          { sourceTag: 'layer:export-raster', onlyDependOnLibsWithTags: ['layer:export-raster'] },
          { sourceTag: 'layer:export-font', onlyDependOnLibsWithTags: ['layer:model', 'layer:export-font'] },
          { sourceTag: 'layer:persistence', onlyDependOnLibsWithTags: ['layer:model', 'layer:application', 'layer:persistence'] },
        ],
      }],
    },
  },
];
