import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the Electron E2E smoke suite (TD-07). These tests launch
 * the *built* Electron app (`out/main/index.js`) and drive the real renderer, so
 * they need the app built first (`pnpm build`) and the Electron binary present
 * (CI must NOT set `ELECTRON_SKIP_BINARY_DOWNLOAD` for the E2E job).
 *
 * There are no browser `projects` here — the suite uses Playwright's `_electron`
 * launcher, not a browser context, so the default (no project) is correct.
 */
export default defineConfig({
  testDir: './e2e',
  // Electron cold-starts (build load + window ready), so give each test headroom.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // One worker: a single Electron instance at a time keeps the smoke suite simple
  // and avoids port/singleton contention in the Main process.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['github']] : [['list']],
});
