import nx from '@nx/eslint-plugin';
import parser from '@typescript-eslint/parser';

export default [
  {
    files: ['packages/**/*.ts'],
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
          { sourceTag: 'layer:geometry', onlyDependOnLibsWithTags: ['layer:model', 'layer:geometry'] },
          { sourceTag: 'layer:geometry-paper', onlyDependOnLibsWithTags: ['layer:model', 'layer:geometry', 'layer:geometry-paper'] },
          { sourceTag: 'layer:export-raster', onlyDependOnLibsWithTags: ['layer:export-raster'] },
          { sourceTag: 'layer:persistence', onlyDependOnLibsWithTags: ['layer:model', 'layer:application', 'layer:persistence'] },
        ],
      }],
    },
  },
];
