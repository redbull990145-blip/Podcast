import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared flat config for every TypeScript package in the monorepo.
 * Apps extend this rather than redefining rules.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.expo/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      // Build scripts and the API run on Node; without this, `URL`, `process`
      // and `Buffer` all read as undefined globals.
      globals: { ...globals.node },
    },
    rules: {
      // `_`-prefixed bindings are an intentional "unused on purpose" marker.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // verbatimModuleSyntax is on, so type-only imports must say so.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Errors are handled, not swallowed.
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // TypeScript already resolves every identifier, and `no-undef` is known to
    // misfire on type-only names. typescript-eslint's own guidance is to turn
    // it off for TS and let the compiler own that check.
    files: ['**/*.ts', '**/*.tsx'],
    rules: { 'no-undef': 'off' },
  },
);
