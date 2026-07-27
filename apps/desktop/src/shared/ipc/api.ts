import type {
  AppEchoInput,
  AppEchoOutput,
  CdpCommandOutput,
  CdpLogEvent,
  CdpNetworkEventOut,
  CdpStatusEvent,
  DoctorCheckOutput,
  DevicesLaunchOutput,
  MetroStartInput,
  MetroStartOutput,
} from './contracts.js';
import type {
  AutoAttachSetInput,
  AutoAttachStatus,
  DevicesBootInput,
  DevicesInstallInput,
  DevicesLaunchInput,
  DevicesListOutput,
  UnifiedLogSnapshot,
  UnifiedLogDeltaOut,
  AiKeyStatus,
  AiKeySetInput,
  AiAskInput,
  AiPreviewInput,
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

  /** List the available iOS simulators (E-09). */
  devicesList(): Promise<DevicesListOutput>;
  /** Boot a simulator by UDID. */
  devicesBoot(input: DevicesBootInput): Promise<void>;
  /** Install an .app bundle on a simulator. */
  devicesInstall(input: DevicesInstallInput): Promise<void>;
  /** Launch an installed app on a simulator. */
  devicesLaunch(input: DevicesLaunchInput): Promise<DevicesLaunchOutput>;

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
  /** The exact redacted payload that would be sent for a question — the "what gets sent" preview. */
  aiPreview(input: AiPreviewInput): Promise<SendPayload>;
  /**
   * Ask the assistant. Resolves with the redacted `SendPayload` that was sent, then streams
   * the answer via `onAiChunk` (+ `onAiDone` / `onAiError`). A new ask cancels any in-flight one.
   */
  aiAsk(input: AiAskInput): Promise<SendPayload>;
  /** Receive streamed answer fragments. Returns an unsubscribe. */
  onAiChunk(handler: (chunk: AiChunkEvent) => void): Unsubscribe;
  /** Notified when the answer stream completes. */
  onAiDone(handler: () => void): Unsubscribe;
  /** Notified when the answer stream fails (includes the no-key case). */
  onAiError(handler: (error: AiErrorEvent) => void): Unsubscribe;
}

declare global {
  interface Window {
    readonly icarus: IcarusApi;
  }
}
