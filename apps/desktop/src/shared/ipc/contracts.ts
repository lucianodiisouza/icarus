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
  /**
   * Command: write the captured unified log to a user-chosen file (E-15, M3 first slice).
   * Opt-in only — the renderer's "Export…" button is the only door. The export applies the
   * same `redact()` rules the E-12 AI boundary uses, so a planted secret never reaches the
   * file (M3 canary in `log-export.test.ts`).
   */
  LOG_EXPORT: 'command:log.export',
  /**
   * Query: snapshot the network inspector's current records (E-16, M3 slice 2).
   * One record per HTTP call, correlated by the CDP `requestId`.
   */
  NETWORK_LIST: 'query:network.list',
  /** Command: wipe the inspector's captured records. */
  NETWORK_CLEAR: 'command:network.clear',
  /**
   * Command: opt-in body fetch (request or response) for a captured `requestId`. The
   * `Network.getRequestPostData` / `Network.getResponseBody` round-trip is expensive
   * (it talks back to the JS context) and can fail (response GC'd, etc.), so it is
   * only ever fired on a renderer's explicit click — never auto.
   */
  NETWORK_FETCH_BODY: 'command:network.fetchBody',
  /**
   * Command: take a snapshot of the running app's React component tree (E-17, M3
   * component tree inspector). Pull-only — the renderer calls this on click
   * (or `Cmd-R`), not on every CDP frame. Returns the correlated `ComponentNode[]`
   * or a typed "why this didn't work" error.
   */
  COMPONENT_TREE_SNAPSHOT: 'command:componentTree.snapshot',
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
  /** A network record was added or updated (E-16, M3 network inspector). */
  NETWORK_RECORD: 'event:network.record',
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

// --- command:log.export (E-15, M3 first slice) ---
/**
 * Input for `command:log.export`. v1 has no per-export toggles — the renderer hands main
 * the entries it currently shows (so the filter chips + search query are the user's intent),
 * and main writes them with redaction always-on (M3 canary in `log-export.test.ts`).
 *
 * Why the renderer is the source of truth: the filter chips live in the renderer, and a
 * filter-by-source/level toggle that main can't see is a footgun. The renderer is the only
 * place that knows "the user is looking at error-only metro output." Main is the trust
 * boundary — it still runs `redact()` on every entry text, so a planted secret in any
 * entry is scrubbed before the file is written. Adding per-export toggles (e.g. an opt-in
 * "include network" switch) is a follow-on.
 */
export const logExportInputSchema = z.object({
  /** The entries to write — exactly the ones the renderer is currently showing. */
  entries: z
    .array(
      z.object({
        source: z.enum(['cdp', 'native', 'metro']),
        level: z.enum(['log', 'info', 'warn', 'error', 'debug']),
        text: z.string(),
        timestampMs: z.number().int().nonnegative(),
        origin: z.string().optional(),
      }),
    )
    .max(20_000), // hard cap; the live log is bounded to 2000 by `UnifiedLogStream`, this is just a belt.
});
export type LogExportInput = z.infer<typeof logExportInputSchema>;
/** A successful export — the path the user picked and the redaction report. */
export interface LogExportOutput {
  /** Absolute path the file was written to. */
  readonly path: string;
  /** Number of entries written. */
  readonly count: number;
  /** What redaction scrubbed, by category — same shape as the AI send-payload report (TR-5). */
  readonly report: import('@icarus/core').RedactionReport;
  /** Approximate file size in bytes. */
  readonly approxBytes: number;
}
/** The `ExportCancelledError` is surfaced to the renderer as a typed IPC rejection
 *  (Electron rejects the `invoke`); the renderer shows no error UI for this case. */

// --- query:network.list / command:network.{clear,fetchBody} (E-16, M3 network inspector) ---
import type { NetworkRecord, NetworkBodyResult } from '@icarus/core';
// Re-export so the renderer's `import type { NetworkRecord } from '../shared/ipc/contracts.js'`
// works — the renderer should never reach into `@icarus/core` directly (it's an Electron-side
// package conceptually, even though it's Electron-free).
export type { NetworkRecord, NetworkBodyResult } from '@icarus/core';
export const networkListInputSchema = z.void();
export type NetworkListOutput = readonly NetworkRecord[];

export const networkClearInputSchema = z.void();

/** Body fetch is opt-in (per-request in the inspector UI). */
export const networkFetchBodyInputSchema = z.object({
  requestId: z.string().min(1),
  kind: z.enum(['request', 'response']),
});
export type NetworkFetchBodyInput = z.infer<typeof networkFetchBodyInputSchema>;
export type NetworkFetchBodyOutput = NetworkBodyResult;

// --- command:componentTree.snapshot (E-17, M3 component tree inspector) ---
import type { ComponentNode } from '@icarus/core';
export type { ComponentNode } from '@icarus/core';
export const componentTreeSnapshotInputSchema = z.void();
/** A typed snapshot result — `ok: true` with a tree, or `ok: false` with a reason. */
export type ComponentTreeSnapshot =
  | { readonly ok: true; readonly roots: readonly ComponentNode[] }
  | { readonly ok: false; readonly kind: 'not_connected' }
  | { readonly ok: false; readonly kind: 'no_root_element' }
  | { readonly ok: false; readonly kind: 'no_fiber_root' }
  | { readonly ok: false; readonly kind: 'no_current_fiber' }
  | {
      readonly ok: false;
      readonly kind: 'remote_exception';
      readonly name: string;
      readonly message: string;
    }
  | { readonly ok: false; readonly kind: 'timeout' }
  | { readonly ok: false; readonly kind: 'cdp_error'; readonly message: string };
