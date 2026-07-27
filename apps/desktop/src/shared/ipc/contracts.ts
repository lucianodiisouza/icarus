import { z } from 'zod';
import type {
  CdpConsoleEntry,
  CdpNetworkEvent,
  DoctorReport,
  MetroLogEvent,
  MetroStatus,
  ProjectKind,
  SimDevice,
  UnifiedLogEntry,
} from '@icarus/core';

/**
 * The IPC contract shared by main, preload, and renderer. This is the single trust
 * boundary (ADR-0004): every channel is explicitly listed here with a runtime input
 * schema (Zod), and anything not registered is rejected. Types flow end-to-end (ADR-0003)
 * so both sides speak the same shapes.
 *
 * Walking-skeleton scope (ADR-0009): query + command only. No subscription/streaming yet.
 * Kept in `src/shared/` rather than a package until a second consumer justifies extraction
 * (Review A-3).
 */
export const CHANNELS = {
  /** Query (read, no side effect): run the environment doctor. */
  DOCTOR_CHECK: 'query:doctor.check',
  /** Command (intent): echo a message back — exercises the command + validation path. */
  APP_ECHO: 'command:app.echo',
  /** Command: connect to a running RN app and start streaming its console logs (E-14). */
  CDP_CONNECT: 'command:cdp.connect',
  /** Command: tear down the live CDP session. */
  CDP_DISCONNECT: 'command:cdp.disconnect',
  /** Command: start Metro for the given project directory (E-08). */
  METRO_START: 'command:metro.start',
  /** Command: stop the running Metro process (E-08). */
  METRO_STOP: 'command:metro.stop',
  /** Query: list available iOS simulators (E-09). */
  DEVICES_LIST: 'query:devices.list',
  /** Command: boot a simulator by UDID (E-09). */
  DEVICES_BOOT: 'command:devices.boot',
  /** Command: install an .app bundle on a simulator (E-09). */
  DEVICES_INSTALL: 'command:devices.install',
  /** Command: launch an installed app on a simulator (E-09). */
  DEVICES_LAUNCH: 'command:devices.launch',
  /** Query: get the current auto-attach enabled flag (TD-16). */
  AUTO_ATTACH_GET: 'query:autoAttach.get',
  /** Command: set the auto-attach enabled flag. */
  AUTO_ATTACH_SET: 'command:autoAttach.set',
  /** Query: assistant key status — is a BYOK key set, is secure storage available (E-13). */
  AI_KEY_STATUS: 'query:ai.keyStatus',
  /** Command: store the BYOK API key (encrypted). Rejects if secure storage is unavailable. */
  AI_KEY_SET: 'command:ai.keySet',
  /** Command: clear the stored BYOK key. */
  AI_KEY_CLEAR: 'command:ai.keyClear',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

/**
 * Subscription primitive (E-03s, ADR-0006) — the third IPC vocabulary after
 * query/command. A subscription is per-window (it needs the calling
 * `webContents` to push deltas to), so it is NOT routed through the
 * window-agnostic `IpcRouter`; it is bound directly with access to `event.sender`.
 *
 * `UNIFIED_LOG` (invoke): starts the subscription for the calling window and
 * returns the current snapshot. `UNIFIED_LOG_STOP` (invoke): ends it. Deltas
 * arrive on the one-way `EVENTS.UNIFIED_LOG_DELTA` channel.
 */
export const SUBSCRIPTIONS = {
  UNIFIED_LOG: 'subscribe:unifiedLog',
  UNIFIED_LOG_STOP: 'unsubscribe:unifiedLog',
  /**
   * The two-step consent-gated ask (E-12 T-12.5 / E-13). Per-window like the log subscription
   * (each holds a pending reviewed payload keyed by `webContents`), so bound directly, not routed.
   *
   * `AI_REVIEW` (invoke): builds the exact redacted `SendPayload` for a question + category
   * toggles and holds it as this window's pending payload, returning it for the user to review.
   * `AI_SEND` (invoke): sends that held payload — exactly what was reviewed, no re-derivation —
   * returning it, then streaming the answer on `EVENTS.AI_CHUNK` / `AI_DONE` / `AI_ERROR`. A new
   * review replaces the pending payload; a new send cancels any in-flight one for the window.
   */
  AI_REVIEW: 'subscribe:ai.review',
  AI_SEND: 'subscribe:ai.send',
} as const;

/**
 * One-way main → renderer push channels (streamed via webContents.send, not the
 * request/response router). This is the first streaming IPC — justified by a real stream
 * (live logs), per ADR-0009.
 *
 * Only the CDP session lives here — it is a session object, not a registered
 * FeatureModule. Registered modules (metro, unified-log, …) push over the
 * generic `module.{id}.event.{name}` channels wired by `bindRegistryToWindow`
 * (TD-15), so they need no per-channel entry in this map.
 */
export const EVENTS = {
  CDP_LOG: 'event:cdp.log',
  CDP_STATUS: 'event:cdp.status',
  CDP_NETWORK: 'event:cdp.network',
  /** Batched append-deltas for the unified-log subscription (E-03s). */
  UNIFIED_LOG_DELTA: 'event:unifiedLog.delta',
  /** A streamed fragment of the assistant's answer (E-13). */
  AI_CHUNK: 'event:ai.chunk',
  /** The assistant answer stream finished. */
  AI_DONE: 'event:ai.done',
  /** The assistant answer stream failed (or no key). */
  AI_ERROR: 'event:ai.error',
} as const;

export type CdpConnectionStatus =
  'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error';

/** Whether the running RN app supports CDP `Network.enable` (RN ≥ 0.76). */
export type CdpNetworkSupport = 'available' | 'unavailable';

export type CdpLogEvent = CdpConsoleEntry;
export type CdpNetworkEventOut = CdpNetworkEvent;
export interface CdpStatusEvent {
  readonly status: CdpConnectionStatus;
  readonly detail?: string;
  readonly networkSupport?: CdpNetworkSupport;
}

// --- query:doctor.check ---
export const doctorCheckInputSchema = z.void();
export type DoctorCheckInput = z.infer<typeof doctorCheckInputSchema>;
export type DoctorCheckOutput = DoctorReport;

// --- command:app.echo ---
export const appEchoInputSchema = z.object({
  message: z.string().min(1).max(500),
});
export type AppEchoInput = z.infer<typeof appEchoInputSchema>;
export interface AppEchoOutput {
  readonly echoed: string;
  readonly at: string;
}

// --- command:cdp.connect / cdp.disconnect ---
export const cdpConnectInputSchema = z.void();
export const cdpDisconnectInputSchema = z.void();
export interface CdpCommandOutput {
  readonly status: CdpConnectionStatus;
}

// --- command:metro.start / metro.stop (E-08) ---
export const metroStartInputSchema = z.object({
  cwd: z.string().min(1),
});
export type MetroStartInput = z.infer<typeof metroStartInputSchema>;
export type { MetroStatus, ProjectKind };
export interface MetroStartOutput {
  readonly status: MetroStatus;
  readonly port: number | null;
  readonly projectName: string | null;
  readonly projectKind: ProjectKind;
}
export const metroStopInputSchema = z.void();

export type MetroLogEventOut = MetroLogEvent;
export interface MetroStatusEvent {
  readonly status: MetroStatus;
  readonly port: number | null;
  readonly projectName: string | null;
  readonly projectKind: ProjectKind;
}

// --- query:devices.list / command:devices.{boot,install,launch} (E-09) ---
export const devicesListInputSchema = z.void();
export type { SimDevice };
export type DevicesListOutput = SimDevice[];

// --- E-10 unified log event ---
export type { UnifiedLogEntry };
export type UnifiedLogEntryOut = UnifiedLogEntry;

// --- E-03s unified-log subscription (snapshot + batched deltas) ---
/** Initial snapshot returned by `SUBSCRIPTIONS.UNIFIED_LOG` — recent history. */
export type UnifiedLogSnapshot = readonly UnifiedLogEntryOut[];
/** A batched append-delta pushed on `EVENTS.UNIFIED_LOG_DELTA`. */
export interface UnifiedLogDeltaOut {
  readonly appended: readonly UnifiedLogEntryOut[];
}

export const devicesBootInputSchema = z.object({
  udid: z.string().min(1),
});
export type DevicesBootInput = z.infer<typeof devicesBootInputSchema>;

export const devicesInstallInputSchema = z.object({
  udid: z.string().min(1),
  appPath: z.string().min(1),
});
export type DevicesInstallInput = z.infer<typeof devicesInstallInputSchema>;

export const devicesLaunchInputSchema = z.object({
  udid: z.string().min(1),
  bundleId: z.string().min(1),
});
export type DevicesLaunchInput = z.infer<typeof devicesLaunchInputSchema>;
export interface DevicesLaunchOutput {
  readonly pid: string;
}

// --- query:autoAttach.get / command:autoAttach.set (TD-16) ---
export const autoAttachGetInputSchema = z.void();
export interface AutoAttachStatus {
  readonly enabled: boolean;
  /** Set when the user explicitly clicks Disconnect on CDP; resets on enable. */
  readonly userDisconnected: boolean;
}
export const autoAttachSetInputSchema = z.object({
  enabled: z.boolean(),
});
export type AutoAttachSetInput = z.infer<typeof autoAttachSetInputSchema>;

// --- AI assistant (E-12 / E-13) ---
export type { SendPayload, RedactionReport, RedactionCategory } from '@icarus/core';
export const aiKeyStatusInputSchema = z.void();
export interface AiKeyStatus {
  readonly hasKey: boolean;
  readonly secureStorageAvailable: boolean;
}
export const aiKeySetInputSchema = z.object({ key: z.string().min(1).max(500) });
export type AiKeySetInput = z.infer<typeof aiKeySetInputSchema>;
export const aiKeyClearInputSchema = z.void();

/** The question + category toggles (T-12.6) that `ai.review` turns into a reviewable payload. */
export const aiReviewInputSchema = z.object({
  question: z.string().min(1).max(2000),
  includeLogs: z.boolean().optional(),
  includeNetwork: z.boolean().optional(),
});
export type AiReviewInput = z.infer<typeof aiReviewInputSchema>;

/** A streamed fragment of the answer (EVENTS.AI_CHUNK). */
export interface AiChunkEvent {
  readonly text: string;
}
/** A failed answer stream (EVENTS.AI_ERROR). `noKey` distinguishes the "add a key" state. */
export interface AiErrorEvent {
  readonly message: string;
  readonly noKey: boolean;
}
