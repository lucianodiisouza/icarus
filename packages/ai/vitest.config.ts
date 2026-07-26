import { defineConfig } from 'vitest/config';

/**
 * Coverage gate for `@icarus/ai` (E-13). Like `@icarus/core`, this package is
 * Electron-free and unit-testable with an injected fake Anthropic client, so it
 * is held to the same real coverage bar. The `index.ts` barrel is excluded (it
 * compiles to nothing but re-exports).
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
