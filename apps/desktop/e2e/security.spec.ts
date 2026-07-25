import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_ENTRY = join(__dirname, '..', 'out', 'main', 'index.js');

/**
 * Security-baseline E2E (TD-06, ADR-0004). The renderer is untrusted; these
 * tests assert the hardening flags on the *live* window rather than trusting the
 * source. They run against the built (production) app, so the strict CSP is in
 * force (dev relaxes it for Vite HMR). Complements the contextIsolation /
 * nodeIntegration checks in app-smoke.spec.ts.
 */
test.describe('security baseline (ADR-0004)', () => {
  let app: ElectronApplication;

  test.beforeEach(async () => {
    app = await electron.launch({ args: [MAIN_ENTRY] });
  });

  test.afterEach(async () => {
    await app.close();
  });

  test('window is sandboxed with context isolation and no node integration', async () => {
    // Ensure the window + webContents exist before querying Main.
    await app.firstWindow();
    // Read the authoritative webPreferences from the Main process — stronger than
    // probing renderer globals, since it reflects what Electron actually applied.
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win?.webContents.getLastWebPreferences() ?? null;
    });
    expect(prefs).not.toBeNull();
    expect(prefs?.sandbox).toBe(true);
    expect(prefs?.contextIsolation).toBe(true);
    expect(prefs?.nodeIntegration).toBe(false);
  });

  test('renderer realm has no Node globals but does expose the narrow bridge', async () => {
    const window = await app.firstWindow();
    // The observable effect of contextIsolation + nodeIntegration=false: the
    // renderer can't reach `require`/`process`, but the allowlisted preload API
    // is present. (The previous test asserts the config; this asserts the effect.)
    const globals = await window.evaluate(() => {
      const w = globalThis as Record<string, unknown>;
      return {
        hasRequire: typeof w['require'] !== 'undefined',
        hasProcess: typeof w['process'] !== 'undefined',
        hasIcarus: typeof w['icarus'] !== 'undefined',
      };
    });
    expect(globals).toEqual({ hasRequire: false, hasProcess: false, hasIcarus: true });
  });

  test('CSP blocks inline scripts (strict production policy)', async () => {
    const window = await app.firstWindow();
    // The prod CSP is `script-src 'self'` — no 'unsafe-inline'. Injecting an
    // inline <script> must NOT execute, so the probe global stays unset. This
    // proves the CSP header is present AND strict, without reading headers.
    const inlineRan = await window.evaluate(async () => {
      const w = globalThis as Record<string, unknown>;
      delete w['__cspInlineProbe'];
      const s = document.createElement('script');
      s.textContent = 'globalThis.__cspInlineProbe = true;';
      document.body.appendChild(s);
      await new Promise((r) => setTimeout(r, 50));
      return w['__cspInlineProbe'] === true;
    });
    expect(inlineRan).toBe(false);
  });

  test('window.open is denied (setWindowOpenHandler allowlist)', async () => {
    const window = await app.firstWindow();
    const before = app.windows().length;
    const opened = await window.evaluate(() => {
      const child = window.open('https://example.com', '_blank');
      return child !== null;
    });
    expect(opened).toBe(false);
    // Give any (wrongly) spawned window a beat to appear, then confirm none did.
    await new Promise((r) => setTimeout(r, 200));
    expect(app.windows().length).toBe(before);
  });

  test('external navigation is refused (will-navigate deny)', async () => {
    const window = await app.firstWindow();
    const startUrl = window.url();
    // Attempt to navigate the frame to an external origin; the will-navigate
    // handler preventDefaults it, so the renderer stays on the app document.
    await window.evaluate(() => {
      window.location.href = 'https://example.com/';
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(window.url()).toBe(startUrl);
  });
});
