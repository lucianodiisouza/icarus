import type { CdpNetworkEvent } from '../cdp/network.js';
import type { NetworkRecord } from './aggregate.js';

/**
 * The M3 network inspector's live state (E-16, slice 2 of the M3 additive backlog).
 *
 * A `NetworkRecorder` is a sink for raw `CdpNetworkEvent`s — same shape as the
 * `UnifiedLogController` (fan-in + per-subscriber fan-out) — that internally maintains
 * the correlated `NetworkRecord` model and notifies subscribers when records are added
 * or updated. Pure and Electron-free; the desktop wiring feeds it CDP events from the
 * live session.
 *
 * Why this shape:
 *   - The renderer (and the AI assistant) want **records**, not events. Doing the
 *     correlation in `core` keeps the renderer simple and means a single source of
 *     truth for the model.
 *   - A small bounded buffer (`maxRecords`) caps memory under load — a chatty app can
 *     issue thousands of calls per minute; the inspector is a tail, not a full log.
 *     The default (500) is what Chrome DevTools keeps.
 *   - `onRecord(handler)` is called on every state change (add or update). The caller
 *     decides whether to push to the renderer every time or batch — the E-15 export
 *     pattern was "push every event"; the E-16 inspector pattern is "push every record,"
 *     because per-record volume is small.
 */
export interface NetworkRecorderOptions {
  /** Bounded cap on the number of records kept. Older ones drop off the front. Default 500. */
  readonly maxRecords?: number;
}

export type NetworkRecordHandler = (record: NetworkRecord) => void;

export class NetworkRecorder {
  readonly #maxRecords: number;
  /** Records indexed by `requestId` for O(1) update on subsequent events. */
  readonly #byId = new Map<string, NetworkRecord>();
  /** Insertion order of `requestId`s — used for the snapshot. */
  readonly #order: string[] = [];
  readonly #handlers = new Set<NetworkRecordHandler>();

  constructor(options: NetworkRecorderOptions = {}) {
    this.#maxRecords = options.maxRecords ?? 500;
  }

  /**
   * Feed one raw CDP `CdpNetworkEvent`. Returns the resulting (added-or-updated) record,
   * or `null` if the event was dropped (no `requestId` or otherwise unusable). The return
   * value is convenient for tests + the desktop wiring's own diagnostics.
   */
  push(event: CdpNetworkEvent): NetworkRecord | null {
    if (!event.requestId) return null;
    // Re-run the aggregator on the *new* event only. The aggregator is pure and works
    // on a single event correctly (it produces one record per event, then merges by id
    // when the next event arrives). The trick: we keep the full historical view by
    // re-aggregating over the existing `order`-derived events — but that would be O(n²).
    // Instead, we maintain the mutable record directly (mirroring `aggregateNetworkEvents`'s
    // logic) so updates are O(1).
    const prev = this.#byId.get(event.requestId);
    if (prev !== undefined && event.kind === 'request') {
      // A second 'request' event for the same id is rare; ignore (CDP may emit one for
      // a redirect, but the new URL is the same one we'd see on the response).
      return prev;
    }
    const next = applyEvent(prev, event);
    this.#byId.set(event.requestId, next);
    if (prev === undefined) {
      this.#order.push(event.requestId);
      // Bound the buffer: drop from the front.
      while (this.#order.length > this.#maxRecords) {
        const dropped = this.#order.shift();
        if (dropped !== undefined) this.#byId.delete(dropped);
      }
    }
    for (const h of this.#handlers) h(next);
    return next;
  }

  /** Subscribe to record additions + updates. Returns an unsubscribe. */
  onRecord(handler: NetworkRecordHandler): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  /** The current snapshot, in request-arrival order. */
  records(): readonly NetworkRecord[] {
    const out: NetworkRecord[] = [];
    for (const id of this.#order) {
      const rec = this.#byId.get(id);
      if (rec !== undefined) out.push(rec);
    }
    return out;
  }

  /** Number of records currently held. */
  get size(): number {
    return this.#order.length;
  }

  /** Wipe everything (used by the renderer's "Clear" button). */
  clear(): void {
    this.#byId.clear();
    this.#order.length = 0;
  }
}

/**
 * Apply a single event to an existing record (or start a new one). Mirrors the switch
 * in `aggregateNetworkEvents` but operates on a single record at a time. Pure.
 */
function applyEvent(prev: NetworkRecord | undefined, ev: CdpNetworkEvent): NetworkRecord {
  const base: MutableRecord =
    prev === undefined
      ? {
          requestId: ev.requestId,
          url: ev.url ?? '',
          method: upperMethod(ev.method),
          requestTimestampMs: ev.timestampMs,
          ended: false,
        }
      : { ...(prev as MutableRecord) };

  switch (ev.kind) {
    case 'request': {
      if (prev === undefined) {
        // first event for this id: URL/method from the request
        base.url = ev.url ?? '';
        base.method = upperMethod(ev.method);
        base.requestTimestampMs = ev.timestampMs;
      }
      if (ev.requestHeaders !== undefined) base.requestHeaders = ev.requestHeaders;
      break;
    }
    case 'response': {
      base.responseTimestampMs = ev.timestampMs;
      base.endTimestampMs = ev.timestampMs;
      if (ev.url) base.url = ev.url;
      if (ev.method) base.method = upperMethod(ev.method);
      if (typeof ev.status === 'number' && Number.isFinite(ev.status)) base.status = ev.status;
      if (ev.statusText) base.statusText = ev.statusText;
      if (ev.contentType) base.contentType = ev.contentType;
      if (ev.responseHeaders !== undefined) base.responseHeaders = ev.responseHeaders;
      base.ended = true;
      break;
    }
    case 'failed': {
      base.endTimestampMs = ev.timestampMs;
      if (ev.errorText) base.failure = ev.errorText;
      base.ended = true;
      break;
    }
    case 'finished': {
      if (typeof ev.encodedDataLength === 'number' && Number.isFinite(ev.encodedDataLength)) {
        base.encodedDataLength = ev.encodedDataLength;
      }
      if (base.endTimestampMs === undefined || ev.timestampMs > base.endTimestampMs) {
        base.endTimestampMs = ev.timestampMs;
      }
      base.ended = true;
      break;
    }
  }
  return freeze(base);
}

type HttpMethod = NetworkRecord['method'];

function upperMethod(method: string | undefined): HttpMethod {
  if (method === undefined) return 'GET';
  return method.toUpperCase();
}

interface MutableRecord {
  requestId: string;
  url: string;
  method: HttpMethod;
  status?: number;
  statusText?: string;
  contentType?: string;
  requestHeaders?: Readonly<Record<string, string>>;
  responseHeaders?: Readonly<Record<string, string>>;
  requestTimestampMs: number;
  responseTimestampMs?: number;
  endTimestampMs?: number;
  encodedDataLength?: number;
  failure?: string;
  ended: boolean;
}

function freeze(rec: MutableRecord): NetworkRecord {
  // Single point that enforces the on-the-wire shape under `exactOptionalPropertyTypes`:
  // omit keys that are undefined.
  const out: Record<string, unknown> = {
    requestId: rec.requestId,
    url: rec.url,
    method: rec.method,
    requestTimestampMs: rec.requestTimestampMs,
    ended: rec.ended,
  };
  for (const [k, v] of Object.entries(rec)) {
    if (
      v !== undefined &&
      k !== 'requestId' &&
      k !== 'url' &&
      k !== 'method' &&
      k !== 'requestTimestampMs' &&
      k !== 'ended'
    ) {
      out[k] = v;
    }
  }
  return out as unknown as NetworkRecord;
}

// Re-export the pure helper so the desktop + renderer can build a fresh aggregate if
// they want (e.g. from a saved event log). The recorder is the live path.
export { aggregateNetworkEvents, durationMs, ttfbMs, type NetworkRecord } from './aggregate.js';
