import { defineConfig } from 'vitest/config';

/**
 * Coverage gate for `@icarus/core` (TD-10). `core` is the Electron-free heart of
 * the app (ADR-0002) and the one package that is fully unit-testable without a
 * shell — so it is the package we hold to a real coverage bar. The apps/desktop
 * shell is covered by its own tests but not gated here (much of it is thin
 * Electron glue that needs an E2E harness — see TD-06/TD-07).
 *
 * The threshold is enforced in CI via `pnpm --filter @icarus/core test:coverage`.
 * A drop below it fails the build, so coverage can only ratchet up.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Non-executable files: barrel re-exports and type-only declaration
      // modules compile to nothing, so they only add 0%-of-0 noise. The real
      // process adapters (NodeToolRunner, simctl/syslog executors) are kept in
      // and are the honest source of the sub-100% number — their logic is
      // tested via injected fakes; only the `execFile`/`spawn` last mile isn't.
      exclude: [
        'src/**/*.test.ts',
        'src/**/index.ts',
        'src/**/types.ts',
        'src/unified-log/unified-log.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
