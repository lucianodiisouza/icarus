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
      '@typescript-eslint/no-floating-promises': 'off', // requires type-aware linting; enabled per-package later
      'no-console': 'off',
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
);
