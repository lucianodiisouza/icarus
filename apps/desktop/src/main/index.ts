import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { CHANNELS } from '../shared/ipc/contracts.js';
import { registerHandlers } from './ipc/handlers.js';
import { IpcRouter } from './ipc/router.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Electron main process — a thin orchestrator (Architecture §Main). Its jobs: own the
 * window/lifecycle, enforce the security baseline (ADR-0004), and bind the typed IPC
 * router to `ipcMain`. All real logic lives in the Electron-free core/router.
 */

const router = new IpcRouter();
registerHandlers(router);

/** Bind every registered channel to ipcMain.handle, routing through the validated router. */
function bindIpc(): void {
  for (const channel of Object.values(CHANNELS)) {
    ipcMain.handle(channel, async (_event, rawInput: unknown) => {
      // Errors (unknown channel / invalid input / handler failure) propagate to the
      // renderer as rejected invokes — never as an unhandled crash.
      return router.dispatch(channel, rawInput);
    });
  }
}

function applyContentSecurityPolicy(): void {
  // Strict CSP: only our own bundled assets; no remote code (ADR-0004).
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
        ],
      },
    });
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 750,
    show: false,
    webPreferences: {
      // Security baseline (ADR-0004): renderer is untrusted.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, '../preload/index.mjs'),
    },
  });

  window.once('ready-to-show', () => window.show());

  // Refuse navigation to any external origin and block new windows (ADR-0004).
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  applyContentSecurityPolicy();
  bindIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
