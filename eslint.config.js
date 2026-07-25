// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for the Icarus monorepo.
 *
 * The load-bearing rule here is the architecture boundary (ADR-0002): `packages/core`
 * is shell-agnostic and MUST NOT import Electron or any renderer-only code. That is a
 * correctness property, enforced in CI — not a convention (see docs/engineering/12).
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/build/**',
      '**/node_modules/**',
      'spike/**', // disposable spike code (docs/engineering/19) — not held to product standards
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'off',
    },
  },
  {
    // Type-aware linting (TD-09). Scoped to `src/**` because those are the files
    // in each package's tsconfig — the stray config files (`vitest.config.ts`,
    // and any tool config outside `src`) aren't in a project, so keeping them
    // out of this block avoids "file not found in project" parser errors while
    // still parsing them non-type-aware elsewhere.
    //
    // We deliberately enable ONLY `no-floating-promises` here, not the full
    // `recommendedTypeChecked` preset: an unhandled promise is a real
    // correctness bug (a rejection nobody sees, work that outlives its caller),
    // and this is a Main-process + async-heavy codebase. The broader preset is a
    // separate decision.
    files: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    // The architecture boundary: core stays Electron-free and renderer-free.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message:
                'packages/core must stay shell-agnostic (ADR-0002). No Electron imports in core.',
            },
          ],
          patterns: [
            {
              group: ['electron', 'electron/*', '**/renderer/**'],
              message:
                'packages/core must stay shell-agnostic (ADR-0002). No Electron / renderer imports in core.',
            },
          ],
        },
      ],
    },
  },
  {
    // Test files may use dev-only globals.
    files: ['**/*.test.ts'],
    rules: {},
  },
  {
    // Plain-JS test fixtures run under Node; declare the Node globals they use so
    // no-undef doesn't fire (TS files get these from tsconfig types instead).
    files: ['**/*.mjs', '**/__fixtures__/**'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
);
