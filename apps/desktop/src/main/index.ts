import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import {
  CdpClient,
  DevicesController,
  discoverProxies,
  MetroController,
  ProcessManager,
  UnifiedLogController,
} from '@icarus/core';
import {
  CHANNELS,
  cdpConnectInputSchema,
  cdpDisconnectInputSchema,
  devicesBootInputSchema,
  devicesInstallInputSchema,
  devicesLaunchInputSchema,
  devicesListInputSchema,
  EVENTS,
  metroStartInputSchema,
  metroStopInputSchema,
  type CdpCommandOutput,
  type DevicesLaunchOutput,
  type DevicesListOutput,
  type MetroStartOutput,
  type MetroStatusEvent,
} from '../shared/ipc/contracts.js';
import { registerHandlers } from './ipc/handlers.js';
import { IpcRouter } from './ipc/router.js';
import { CdpSession } from './cdp/cdp-session.js';
import { startCdpProxy } from './cdp/ws-proxy.js';
import { wsSocketFactory } from './cdp/ws-socket-factory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The single ProcessManager for the app. Nothing spawns through it yet (M1's metro/devices
 * modules will), but its teardown is wired to app exit now so the "no orphans" guarantee
 * (G-2, TR-2) holds the moment the first process is spawned.
 */
const processes = new ProcessManager();

/**
 * The single MetroController (E-08). One Metro at a time per app. Spawned by the same
 * ProcessManager so its teardown is covered by the app-exit hook above.
 */
const metro = new MetroController({ processes });

/**
 * The single DevicesController (E-09). iOS-first; the underlying `simctl` invocations
 * share the app's ProcessManager so no orphans.
 */
const devices = new DevicesController({ processes });

/**
 * The single UnifiedLogController (E-10). Fan-in for CDP console events + Metro
 * lines. The renderer subscribes to the same stream via IPC, so this is the
 * single source of truth for "what just happened in the app."
 */
const unified = new UnifiedLogController();

function wireProcessTeardown(): void {
  app.on('will-quit', () => {
    void processes.disposeAll();
  });
  const onSignal = (): void => {
    void processes.disposeAll().finally(() => process.exit(0));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}

/**
 * Electron main process — a thin orchestrator (Architecture §Main). Its jobs: own the
 * window/lifecycle, enforce the security baseline (ADR-0004), and bind the typed IPC
 * router to `ipcMain`. All real logic lives in the Electron-free core/router.
 */

const router = new IpcRouter();
registerHandlers(router);

/**
 * The live CDP session (E-14). Created once a window exists (its onLog/onStatus push to
 * that window's renderer). The connect/disconnect commands drive it.
 */
let cdpSession: CdpSession | undefined;

function createCdpSession(window: BrowserWindow): CdpSession {
  const push = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };
  return new CdpSession({
    discover: async () => (await discoverProxies()).flatMap((proxy) => proxy.targets),
    startProxy: (upstreamUrl) => startCdpProxy({ upstreamUrl }),
    createClient: (downstreamUrl) =>
      new CdpClient(downstreamUrl, { socketFactory: wsSocketFactory }),
    onLog: (entry) => {
      push(EVENTS.CDP_LOG, entry);
      // Fan in to the unified log stream (E-10).
      unified.pushCdp(entry);
    },
    onNetwork: (event) => push(EVENTS.CDP_NETWORK, event),
    onStatus: (event) => push(EVENTS.CDP_STATUS, event),
  });
}

router.register(
  CHANNELS.CDP_CONNECT,
  cdpConnectInputSchema,
  async (): Promise<CdpCommandOutput> => {
    await cdpSession?.connect();
    return { status: cdpSession?.status ?? 'disconnected' };
  },
);
router.register(
  CHANNELS.CDP_DISCONNECT,
  cdpDisconnectInputSchema,
  async (): Promise<CdpCommandOutput> => {
    await cdpSession?.disconnect();
    return { status: 'disconnected' };
  },
);

router.register(
  CHANNELS.METRO_START,
  metroStartInputSchema,
  async ({ cwd }): Promise<MetroStartOutput> => {
    const started = await metro.start(cwd);
    return {
      status: metro.status,
      port: started.port,
      projectName: started.project.name,
      projectKind: started.project.kind,
    };
  },
);

router.register(CHANNELS.METRO_STOP, metroStopInputSchema, async (): Promise<void> => {
  await metro.stop();
});

router.register(
  CHANNELS.DEVICES_LIST,
  devicesListInputSchema,
  async (): Promise<DevicesListOutput> => devices.list({ refresh: true }),
);

router.register(CHANNELS.DEVICES_BOOT, devicesBootInputSchema, async ({ udid }): Promise<void> => {
  await devices.boot(udid);
});

router.register(
  CHANNELS.DEVICES_INSTALL,
  devicesInstallInputSchema,
  async ({ udid, appPath }): Promise<void> => {
    await devices.install(udid, appPath);
  },
);

router.register(
  CHANNELS.DEVICES_LAUNCH,
  devicesLaunchInputSchema,
  async ({ udid, bundleId }): Promise<DevicesLaunchOutput> => {
    const pid = await devices.launch(udid, bundleId);
    return { pid };
  },
);

function buildMetroStatusEvent(): MetroStatusEvent {
  return {
    status: metro.status,
    port: metro.port,
    projectName: metro.project?.name ?? null,
    projectKind: metro.project?.kind ?? 'unknown',
  };
}

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
  // CSP (ADR-0004). Prod is strict (own bundled assets only, no remote code). Dev must
  // allow the Vite dev server's inline React-refresh preamble + HMR websocket, otherwise
  // the renderer never mounts. Dev is detected by the presence of ELECTRON_RENDERER_URL.
  const isDev = Boolean(process.env['ELECTRON_RENDERER_URL']);
  const policy = isDev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:*; img-src 'self' data:"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
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
      preload: join(__dirname, '../preload/index.cjs'),
    },
  });

  window.once('ready-to-show', () => window.show());
  cdpSession = createCdpSession(window);
  // Push Metro status/log changes to this window. Set up once per window so the
  // controller outlives the window (we tear it down on app exit, not on window close).
  if (!window.isDestroyed()) {
    metro.onLog((event) => {
      if (!window.isDestroyed()) window.webContents.send(EVENTS.METRO_LOG, event);
    });
    metro.onStatus(() => {
      if (!window.isDestroyed())
        window.webContents.send(EVENTS.METRO_STATUS, buildMetroStatusEvent());
    });
  }
  window.on('closed', () => {
    void cdpSession?.disconnect();
    cdpSession = undefined;
  });

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
  wireProcessTeardown();
  bindIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
