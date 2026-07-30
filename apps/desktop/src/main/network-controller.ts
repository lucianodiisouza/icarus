import type { BrowserWindow } from 'electron';
import {
  fetchRequestBody,
  fetchResponseBody,
  NetworkRecorder,
  type CdpNetworkEvent,
  type CdpSendLike,
  type NetworkBodyResult,
  type NetworkRecord,
  type NetworkRecordHandler,
} from '@icarus/core';
import {
  CHANNELS,
  EVENTS,
  networkFetchBodyInputSchema,
  networkListInputSchema,
  networkClearInputSchema,
} from '../shared/ipc/contracts.js';
import type { IpcRouter } from './ipc/router.js';

/**
 * The desktop wiring of the M3 network inspector (E-16). Mirrors the `AssistantBridge`
 * shape (T-13.5): a small main-process orchestrator that owns a `NetworkRecorder` (the
 * live correlated model) and the body-fetch wrappers (the opt-in CDP round-trips).
 *
 * The renderer speaks to the inspector through the typed router:
 *
 *   - `command:network.list`           → snapshot of the current records
 *   - `command:network.clear`          → wipe the captured records
 *   - `command:network.fetchBody`      → opt-in body fetch (request or response)
 *   - `event:network.record`           → per-record push when a record is added or updated
 *
 * The recorder is fed from the same CDP `Network.*` event stream the assistant's bounded
 * context already consumes — both are independent sinks for the same event. The session
 * itself is unchanged; the wiring just adds a second consumer.
 *
 * Body fetches need a live CDP `send` to round-trip `Network.getRequestPostData` /
 * `Network.getResponseBody`. The wiring injects a thin adapter at registration time so
 * the body fetch uses the **same** connection as the live stream. When the session is
 * disconnected, the fetch returns the typed `'not-fetchable'` answer — the UI shows
 * "body unavailable" rather than crashing.
 */

export interface NetworkController {
  /** Subscribe to record additions + updates. Returns an unsubscribe. */
  readonly onRecord: (handler: NetworkRecordHandler) => () => void;
  /** Current snapshot of the correlated model. */
  readonly records: () => readonly NetworkRecord[];
  /** Wipe everything. */
  readonly clear: () => void;
  /**
   * The `CdpNetworkEvent` sink — call this from the existing `cdp-ipc.onNetwork` so the
   * recorder stays in lock-step with the live session. Returns the resulting record (or
   * null if the event was unusable).
   */
  readonly feed: (event: CdpNetworkEvent) => NetworkRecord | null;
  /** Replace the CDP `send` seam (called on session connect/disconnect). */
  readonly setCdpSend: (send: CdpSendLike | null) => void;
  /** Fetch a body (opt-in). Returns a typed result; never throws. */
  readonly fetchBody: (
    requestId: string,
    kind: 'request' | 'response',
  ) => Promise<NetworkBodyResult>;
}

const MAX_RECORDS_DEFAULT = 500;

export function createNetworkController(): NetworkController {
  const recorder = new NetworkRecorder({ maxRecords: MAX_RECORDS_DEFAULT });
  let cdpSend: CdpSendLike | null = null;

  return {
    onRecord: (h) => recorder.onRecord(h),
    records: () => recorder.records(),
    clear: () => recorder.clear(),
    feed: (event) => recorder.push(event),
    setCdpSend: (send) => {
      cdpSend = send;
    },
    fetchBody: async (requestId, kind) => {
      if (cdpSend === null) {
        return { body: null, skipped: false, reason: 'not-fetchable' };
      }
      if (kind === 'request') return fetchRequestBody(cdpSend, requestId);
      return fetchResponseBody(cdpSend, requestId);
    },
  };
}

export interface RegisterNetworkChannelsDeps {
  readonly router: IpcRouter;
  readonly controller: NetworkController;
  /** The window whose renderer subscribes to `event:network.record` (currently first window). */
  readonly window: () => BrowserWindow | null;
}

/**
 * Register the inspector's IPC channels + the per-window record push. Per-record events
 * are small (one record per HTTP call, low volume) so we don't need a `StreamBatcher` —
 * the E-03s pattern is for the unified log's high-rate stream.
 */
export function registerNetworkChannels(deps: RegisterNetworkChannelsDeps): () => void {
  const { router, controller, window: getWindow } = deps;

  // Forward every recorder event to the renderer (if a window exists).
  const offRecorder = controller.onRecord((record) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(EVENTS.NETWORK_RECORD, record);
  });

  router.register(CHANNELS.NETWORK_LIST, networkListInputSchema, async () => controller.records());
  router.register(CHANNELS.NETWORK_CLEAR, networkClearInputSchema, async () => {
    controller.clear();
  });
  router.register(
    CHANNELS.NETWORK_FETCH_BODY,
    networkFetchBodyInputSchema,
    async ({ requestId, kind }): Promise<NetworkBodyResult> =>
      controller.fetchBody(requestId, kind),
  );

  return () => offRecorder();
}
