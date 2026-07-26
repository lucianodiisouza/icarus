import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import {
  CdpClient,
  createDevicesModule,
  createMetroModule,
  createUnifiedLogModule,
  DevicesController,
  discoverProxies,
  IosSyslogSource,
  MetroController,
  ModuleRegistry,
  ProcessManager,
  UnifiedLogController,
  UnifiedLogStream,
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
  SUBSCRIPTIONS,
  type CdpCommandOutput,
  type DevicesLaunchOutput,
  type DevicesListOutput,
  type MetroStartOutput,
} from '../shared/ipc/contracts.js';
import { z } from 'zod';
import { registerHandlers } from './ipc/handlers.js';
import { IpcRouter } from './ipc/router.js';
import { CdpSession } from './cdp/cdp-session.js';
import { startCdpProxy } from './cdp/ws-proxy.js';
import { wsSocketFactory } from './cdp/ws-socket-factory.js';
import { AutoAttach } from './auto-attach.js';
import { bindRegistryToWindow } from './feature-module-bridge.js';
import { wireMetroIntoUnified } from './unified-fan-in.js';
import { SyslogFanIn } from './syslog-fan-in.js';
import { createOrphanRegistry, reapOrphansFromPreviousRun } from './orphan-reaper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Cross-launch orphan registry (TD-11). Persists every spawned process group to `userData`
 * so a survivor of a hard crash can be reaped at the next launch (see `orphan-reaper.ts`).
 */
const orphanRegistry = createOrphanRegistry(app.getPath('userData'));

/**
 * The single ProcessManager for the app. Every Metro/devices/simctl spawn goes through it,
 * so the "no orphans" guarantee (G-2, TR-2) holds in one place — clean-exit teardown via
 * `disposeAll()` (wired below) and hard-crash survivors via the cross-launch reaper.
 */
const processes = new ProcessManager({ registry: orphanRegistry });

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

/**
 * The renderer-facing unified-log view as a snapshot + batched-delta subscription
 * (E-03s, ADR-0006). This replaces the per-entry push for logs: a high-rate burst
 * (metro build spam, a chatty app) becomes a handful of coalesced deltas rather
 * than thousands of IPC messages + React renders (TR-6). Window: 60ms (≤ ~16
 * renderer updates/sec); snapshot retains the last 2000 entries.
 */
const logStream = new UnifiedLogStream(unified, {
  snapshotCapacity: 2000,
  windowMs: 60,
  maxBatch: 500,
});
/** Per-window unsubscribe handles, keyed by `webContents.id`. */
const logSubscriptions = new Map<number, () => void>();

/**
 * The single ModuleRegistry (TD-15, E-05 follow-up). Owns the lifecycle of
 * every FeatureModule in the app. Each module's `init(ctx)` is called on
 * registration; `disposeAll()` runs on app exit (wired below). The 3 existing
 * modules (Metro, Devices, UnifiedLog) are registered here — adding a new
 * module is one line of `registry.register(...)` and the lifecycle, cleanup
 * trail, and module-id-prefixed logging are all handled automatically.
 *
 * The registry also drives the renderer IPC: `bindRegistryToWindow` (TD-15)
 * iterates the registered modules and auto-wires each one's declared events to
 * the window over the generic `module.{id}.event.{name}` channels — so adding a
 * module needs no per-channel wiring here.
 */
const registry = new ModuleRegistry();
registry.register(createMetroModule(metro), { processes });
registry.register(createDevicesModule(), { processes });
registry.register(createUnifiedLogModule(unified), { processes });

/**
 * Fan Metro output into the unified log (TD-21). CDP console entries are fanned
 * in per-window inside `createCdpSession`; Metro is app-lifetime, so its wire is
 * set up once here and detached on exit.
 */
const unbindMetroFanIn = wireMetroIntoUnified(metro, unified);

/**
 * Fan the booted simulator's native syslog into the unified log (TD-18). Started
 * from the `devices.boot` handler; follows the most recently booted sim, one
 * stream at a time (see SyslogFanIn). The third and last unified-log source.
 */
const syslogFanIn = new SyslogFanIn({
  unified,
  createSource: (udid) => new IosSyslogSource(udid, processes),
});

function wireProcessTeardown(): void {
  app.on('will-quit', () => {
    // Detach the Metro→unified fan-in, then dispose the module registry
    // (releases per-module subscriptions), then the ProcessManager (kills any
    // live child processes). The order matters: a module might still be holding
    // a reference to a process when we tear it down.
    unbindMetroFanIn();
    void syslogFanIn.stop();
    logStream.dispose();
    void registry.disposeAll().finally(() => processes.disposeAll());
  });
  const onSignal = (): void => {
    unbindMetroFanIn();
    void syslogFanIn.stop();
    logStream.dispose();
    void registry.disposeAll().finally(() => processes.disposeAll().finally(() => process.exit(0)));
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
    // Mark the user as "I clicked Disconnect" so the auto-attach policy
    // (TD-16) doesn't fire on the next Metro-ready event. The user can
    // re-enable it from the renderer's auto-attach toggle.
    autoAttach.markUserDisconnected();
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
  // Stream the just-booted sim's native syslog into the unified log (TD-18).
  syslogFanIn.start(udid);
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

// --- auto-attach (TD-16) ---
let autoAttachEnabled = true;
const autoAttach = new AutoAttach({
  isMetroReady: () => metro.status === 'ready',
  firstBootedSimUdid: () => devices.devices.find((d) => d.state === 'Booted')?.udid ?? null,
  cdpConnect: async () => {
    if (cdpSession) await cdpSession.connect();
  },
  isCdpBusy: () => cdpSession?.status === 'connecting' || cdpSession?.status === 'connected',
  isEnabled: () => autoAttachEnabled,
  setEnabled: (enabled) => {
    autoAttachEnabled = enabled;
  },
});

router.register(CHANNELS.AUTO_ATTACH_GET, z.void(), async () => ({
  enabled: autoAttachEnabled,
  userDisconnected: autoAttach.userDisconnected,
}));
router.register(
  CHANNELS.AUTO_ATTACH_SET,
  z.object({ enabled: z.boolean() }),
  async ({ enabled }) => {
    autoAttachEnabled = enabled;
    if (enabled) autoAttach.clearUserDisconnected();
  },
);

// Wire the auto-attach orchestrator. It subscribes to Metro status changes
// (the only live "trigger" event we have today) and re-evaluates the policy
// each time. The device-list subscription is a no-op until DevicesController
// exposes an onList event (see TD-16 follow-ups).
autoAttach.start({
  onMetroStatusChange: (handler) => metro.onStatus(handler),
  onDevicesListChange: () => () => undefined,
});

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

/**
 * Bind the unified-log subscription (E-03s). Unlike query/command channels this
 * is per-window — it needs the calling `webContents` to push deltas to — so it is
 * bound directly here with `event.sender`, not through the window-agnostic router.
 * Subscribing returns the current snapshot and starts batched deltas; the sub is
 * torn down on explicit stop or when the window's `webContents` is destroyed.
 */
function bindSubscriptions(): void {
  const stop = (id: number): void => {
    logSubscriptions.get(id)?.();
    logSubscriptions.delete(id);
  };
  ipcMain.handle(SUBSCRIPTIONS.UNIFIED_LOG, (event) => {
    const wc = event.sender;
    stop(wc.id); // replace any prior subscription for this window (e.g. a reload)
    const off = logStream.subscribe((delta) => {
      if (!wc.isDestroyed()) wc.send(EVENTS.UNIFIED_LOG_DELTA, delta);
    });
    logSubscriptions.set(wc.id, off);
    wc.once('destroyed', () => stop(wc.id));
    return logStream.snapshot();
  });
  ipcMain.handle(SUBSCRIPTIONS.UNIFIED_LOG_STOP, (event) => stop(event.sender.id));
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
  // Auto-wire every registered module's events to this window (TD-15). The
  // metro (log/status) and unified-log streams reach the renderer through the
  // generic `module.{id}.event.{name}` channels — no per-module wiring here.
  const unbindModules = bindRegistryToWindow(registry, window);
  window.on('closed', () => {
    unbindModules();
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

void app.whenReady().then(async () => {
  applyContentSecurityPolicy();
  wireProcessTeardown();
  await reapOrphansFromPreviousRun(orphanRegistry);
  bindIpc();
  bindSubscriptions();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
