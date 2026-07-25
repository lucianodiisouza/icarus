import { defineConfig } from 'vitest/config';

/**
 * Vitest (unit) config for the desktop app. Scoped to `src/**` so the runner
 * only picks up unit tests — the Playwright E2E specs under `e2e/` use a
 * different runner (`@playwright/test`) and API, and Vitest's default glob
 * would otherwise try to execute them (`.spec.ts` matches its default include).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
