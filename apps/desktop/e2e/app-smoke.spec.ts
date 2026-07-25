import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** The built Main entry — E2E runs against the production bundle, not dev. */
const MAIN_ENTRY = join(__dirname, '..', 'out', 'main', 'index.js');

/**
 * Electron E2E smoke suite (TD-07). The unit tests exercise controllers and the
 * IPC router in isolation; these tests prove the *assembled* app actually boots
 * — Main creates the hardened window, the preload bridge exposes `window.icarus`,
 * and a real query round-trips renderer → preload → ipcMain → router → core and
 * back. If any wiring seam is broken, unit tests stay green but this fails.
 */
test.describe('Icarus desktop app', () => {
  let app: ElectronApplication;

  test.beforeEach(async () => {
    // Launch the built app. No ELECTRON_RENDERER_URL → Main loads the bundled
    // renderer from disk (production path), so this needs `pnpm build` first.
    app = await electron.launch({ args: [MAIN_ENTRY] });
  });

  test.afterEach(async () => {
    await app.close();
  });

  test('boots and shows the app shell', async () => {
    const window = await app.firstWindow();
    await expect(window.getByRole('heading', { name: 'Icarus — RNStudio' })).toBeVisible();
    await expect(window.getByText('Walking skeleton')).toBeVisible();
  });

  test('runs the environment doctor end-to-end (renderer → IPC → core)', async () => {
    const window = await app.firstWindow();
    await window.getByRole('button', { name: 'Run environment doctor' }).click();
    // The doctor report only renders if the full IPC round-trip resolved.
    await expect(window.getByText(/^Overall:/)).toBeVisible();
    // Node.js is always present (it's what we're running under), so its check is a
    // stable assertion that the report body — not just the header — populated.
    await expect(window.getByText('Node.js', { exact: false })).toBeVisible();
  });

  test('unified-log subscription round-trips (E-03s snapshot)', async () => {
    const window = await app.firstWindow();
    // The subscribe primitive must resolve with a snapshot array through the full
    // renderer → preload → ipcMain → UnifiedLogStream path. (Empty on a fresh app
    // with no logs yet — we assert the shape, i.e. the wiring, not content.)
    const snapshotIsArray = await window.evaluate(async () => {
      const icarus = (globalThis as Record<string, unknown>)['icarus'] as {
        unifiedLogSubscribe: () => Promise<unknown[]>;
        unifiedLogUnsubscribe: () => Promise<void>;
      };
      const snapshot = await icarus.unifiedLogSubscribe();
      await icarus.unifiedLogUnsubscribe();
      return Array.isArray(snapshot);
    });
    expect(snapshotIsArray).toBe(true);
  });
});
