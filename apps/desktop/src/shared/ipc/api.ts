import type {
  AppEchoInput,
  AppEchoOutput,
  CdpCommandOutput,
  CdpLogEvent,
  CdpNetworkEventOut,
  CdpStatusEvent,
  DoctorCheckOutput,
  BridgeDelta,
  BridgeErrorEvent,
  DevicesLaunchActivityOutput,
  DevicesLaunchOutput,
  MetroStartInput,
  MetroStartOutput,
  LogExportInput,
  LogExportOutput,
  NetworkBodyResult,
  NetworkFetchBodyInput,
  NetworkListOutput,
  NetworkRecord,
  ComponentTreeSnapshot,
  StorageBackendKind,
  StorageDeleteResult,
  StorageGetResult,
  StorageSnapshot,
  PerfSnapshot,
  NavSnapshot,
} from './contracts.js';
import type {
  AutoAttachSetInput,
  AutoAttachStatus,
  DevicesBootInput,
  DevicesInstallApkInput,
  DevicesInstallInput,
  DevicesLaunchActivityInput,
  DevicesLaunchInput,
  DevicesListOutput,
  UnifiedLogSnapshot,
  UnifiedLogDeltaOut,
  AiKeyStatus,
  AiKeySetInput,
  AiReviewInput,
  AiChunkEvent,
  AiErrorEvent,
  SendPayload,
} from './contracts.js';

export type Unsubscribe = () => void;

/**
 * The narrow, typed surface the preload bridge exposes to the renderer as `window.icarus`
 * (ADR-0004). The renderer never touches raw `ipcRenderer`; it calls these methods only.
 */
export interface IcarusApi {
  /** Run the environment doctor and return its report. */
  doctorCheck(): Promise<DoctorCheckOutput>;
  /** Echo a message (demonstrates the validated command path). */
  appEcho(input: AppEchoInput): Promise<AppEchoOutput>;

  /** Connect to a running RN app and start streaming its console logs (E-14). */
  cdpConnect(): Promise<CdpCommandOutput>;
  /** Tear down the live CDP session. */
  cdpDisconnect(): Promise<CdpCommandOutput>;
  /** Subscribe to live console log entries. Returns an unsubscribe function. */
  onCdpLog(handler: (entry: CdpLogEvent) => void): Unsubscribe;
  /** Subscribe to live network events (E-14 slice 5). */
  onCdpNetwork(handler: (event: CdpNetworkEventOut) => void): Unsubscribe;
  /** Subscribe to CDP connection-status changes. Returns an unsubscribe function. */
  onCdpStatus(handler: (status: CdpStatusEvent) => void): Unsubscribe;

  /** Start the Metro dev server for a project (E-08). */
  metroStart(input: MetroStartInput): Promise<MetroStartOutput>;
  /** Stop the running Metro dev server. */
  metroStop(): Promise<void>;

  /** List the available iOS simulators + Android devices/emulators (E-09 / E-22). */
  devicesList(): Promise<DevicesListOutput>;
  /** Boot an iOS simulator by UDID. */
  devicesBoot(input: DevicesBootInput): Promise<void>;
  /** Install an .app bundle on an iOS simulator. */
  devicesInstall(input: DevicesInstallInput): Promise<void>;
  /** Launch an installed app on an iOS simulator. */
  devicesLaunch(input: DevicesLaunchInput): Promise<DevicesLaunchOutput>;
  /** Install an .apk on an Android device/emulator (E-22 / TD-13). */
  devicesInstallApk(input: DevicesInstallApkInput): Promise<void>;
  /** Launch an app's main activity on Android (E-22 / TD-13). */
  devicesLaunchActivity(input: DevicesLaunchActivityInput): Promise<DevicesLaunchActivityOutput>;

  /**
   * Generic event subscription for any registered FeatureModule (TD-15). The
   * renderer subscribes to `(moduleId, eventName)` pairs without needing a
   * per-event IPC channel defined in the preload — this is the single path for
   * every module's push events (metro log/status, unified-log log, and any
   * future module). Adding a module needs no change here.
   *
   * The payload envelope is `{ timestampMs, payload }` — the inner `payload` is
   * the module-specific value the controller emitted.
   */
  onModuleEvent<T = unknown>(
    moduleId: string,
    eventName: string,
    handler: (envelope: { timestampMs: number; payload: T }) => void,
  ): Unsubscribe;

  /**
   * Subscribe to the unified log as a snapshot + batched deltas (E-03s, ADR-0006).
   * Resolves with the current recent-history snapshot and starts delivering
   * batched append-deltas via `onUnifiedLogDelta`. Replaces the old per-entry
   * push so a high-rate stream can't jank the UI (TR-6).
   */
  unifiedLogSubscribe(): Promise<UnifiedLogSnapshot>;
  /** Stop the unified-log subscription for this window. */
  unifiedLogUnsubscribe(): Promise<void>;
  /** Receive batched append-deltas for the unified log. Returns an unsubscribe. */
  onUnifiedLogDelta(handler: (delta: UnifiedLogDeltaOut) => void): Unsubscribe;

  /** Get the current auto-attach status (TD-16). */
  autoAttachGet(): Promise<AutoAttachStatus>;
  /** Set the auto-attach enabled flag. Resetting to enabled also clears the user-disconnected flag. */
  autoAttachSet(input: AutoAttachSetInput): Promise<void>;

  // --- AI assistant (E-12 / E-13) ---
  /** Is a BYOK key set, and is secure storage available to store one? */
  aiKeyStatus(): Promise<AiKeyStatus>;
  /** Store the BYOK API key (encrypted). Rejects if secure storage is unavailable. */
  aiKeySet(input: AiKeySetInput): Promise<void>;
  /** Clear the stored BYOK key. */
  aiKeyClear(): Promise<void>;
  /**
   * Step 1 of the consent-gated ask: build the exact redacted `SendPayload` for a question and
   * hold it as this window's pending payload. Returns it for the user to review before any send.
   */
  aiReview(input: AiReviewInput): Promise<SendPayload>;
  /**
   * Step 2: send the reviewed payload — exactly what `aiReview` returned, nothing re-derived.
   * Resolves with that `SendPayload`, then streams the answer via `onAiChunk` (+ `onAiDone` /
   * `onAiError`). Rejects if there's no pending review. A new send cancels any in-flight one.
   */
  aiSend(): Promise<SendPayload>;
  /** Receive streamed answer fragments. Returns an unsubscribe. */
  onAiChunk(handler: (chunk: AiChunkEvent) => void): Unsubscribe;
  /** Notified when the answer stream completes. */
  onAiDone(handler: () => void): Unsubscribe;
  /** Notified when the answer stream fails (includes the no-key case). */
  onAiError(handler: (error: AiErrorEvent) => void): Unsubscribe;

  /**
   * Write the captured unified log to a user-chosen file (E-15, M3 first slice). The
   * user's click in the renderer is the only door — the IPC is never invoked any other
   * way. `input.entries` is the currently-visible log (the renderer's filter chips +
   * search are the user's intent). Resolves with the path + redaction report. Rejects
   * with `ExportCancelledError` if the user cancels the save dialog (the renderer
   * treats this as a clean no-op).
   */
  logExport(input: LogExportInput): Promise<LogExportOutput>;

  // --- M3 network inspector (E-16) ---
  /** Snapshot of the inspector's current correlated records. */
  networkList(): Promise<NetworkListOutput>;
  /** Wipe the inspector's records. */
  networkClear(): Promise<void>;
  /**
   * Opt-in body fetch for a `requestId`. The CDP round-trip is expensive (and can fail
   * for GC'd responses / binary bodies), so this is only ever fired by a renderer's
   * explicit click on "Fetch request/response body" — never auto.
   */
  networkFetchBody(input: NetworkFetchBodyInput): Promise<NetworkBodyResult>;
  /**
   * Per-record push: fires when a record is added or updated. Subscribe once on mount;
   * the handler is called with the full record. Low volume (per HTTP call), so no
   * batcher is needed.
   */
  onNetworkRecord(handler: (record: NetworkRecord) => void): Unsubscribe;

  // --- M3 component tree inspector (E-17) ---
  /**
   * Take a snapshot of the running app's React component tree. Pull-only — the
   * renderer calls this on click (or `Cmd-R` while focused on the panel); it
   * never sees a stream of trees. The result is a typed union: `ok: true` with
   * `roots: ComponentNode[]`, or `ok: false` with a reason (not_connected, no
   * fiber root, etc.) so the UI can show the right "why this didn't work"
   * message rather than crash.
   */
  componentTreeSnapshot(): Promise<ComponentTreeSnapshot>;

  // --- M3 storage inspector (E-18) ---
  /**
   * List the keys (with value previews) in a JS-side storage backend. Pull-only,
   * click-driven. Returns a typed union: `ok: true` with `keys: StorageKey[]`,
   * or `ok: false` with a reason (not_connected, no_module, ...).
   */
  storageList(input: { backend: StorageBackendKind }): Promise<StorageSnapshot>;
  /**
   * Get the full value of a single key. The renderer is the only door — the
   * IPC is never auto-fired.
   */
  storageGet(input: { backend: StorageBackendKind; key: string }): Promise<StorageGetResult>;
  /**
   * Remove a key from a JS-side storage backend. The renderer is the only
   * door — opt-in per key, never auto.
   */
  storageDelete(input: { backend: StorageBackendKind; key: string }): Promise<StorageDeleteResult>;

  // --- M3 performance inspector (E-19, minimal viable) ---
  /**
   * Take a snapshot of the running app's perf metrics: JS heap, JS metrics,
   * render hot-spots (top 20 by estimated re-render count), and an optional
   * recent-error count. Pull-only on click; the renderer is the only door.
   */
  perfSnapshot(): Promise<PerfSnapshot>;

  // --- M3 navigation inspector (E-20) ---
  /**
   * Take a snapshot of the running app's navigation state. Reads from the
   * user-installed in-app bridge (`globalThis.__ICARUS_NAV_STATE__`).
   * Returns a typed `no_bridge` failure if the app hasn't published the
   * state — the renderer shows a copy-paste snippet for the user to drop
   * into their app.
   */
  navSnapshot(): Promise<NavSnapshot>;

  // --- OQ-22 live in-app bridge (the live-push upgrade of E-19/E-20) ---
  /**
   * Start the nav live-push poller. While running, every change to the
   * `globalThis.__ICARUS_NAV_STATE__` value the user's app publishes is
   * pushed as a `BridgeDelta` via `onBridgeDelta` — no per-render polling.
   * Idempotent. The user installs a one-liner in their app to publish the
   * state; this method is opt-in (the user clicks a button).
   */
  bridgeNavStart(): Promise<void>;
  /** Stop the nav live-push poller. Idempotent. */
  bridgeNavStop(): Promise<void>;
  /**
   * Start the perf-hotspots live-push poller. The user publishes
   * `globalThis.__ICARUS_PERF_HOTSPOTS__ = [...]`; deltas arrive as
   * `BridgeDelta` events on `onBridgeDelta`.
   */
  bridgePerfHotspotsStart(): Promise<void>;
  /** Stop the perf-hotspots live-push poller. Idempotent. */
  bridgePerfHotspotsStop(): Promise<void>;
  /**
   * Subscribe to live in-app bridge deltas (one channel for nav + perf).
   * Returns an unsubscribe. Errors arrive on `onBridgeError` so the UI can
   * show a single "live push stopped — click to restart" hint.
   */
  onBridgeDelta(handler: (delta: BridgeDelta) => void): Unsubscribe;
  /** Subscribe to live in-app bridge errors. */
  onBridgeError(handler: (error: BridgeErrorEvent) => void): Unsubscribe;
}

declare global {
  interface Window {
    readonly icarus: IcarusApi;
  }
}
