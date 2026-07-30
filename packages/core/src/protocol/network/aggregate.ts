import type { CdpNetworkEvent } from '../cdp/network.js';

/**
 * The M3 network inspector's source-of-truth model (E-16, slice 2 of the M3 additive
 * backlog). One `NetworkRecord` per HTTP call — correlated by the CDP `requestId` — not
 * per raw event. The renderer's panel maps 1:1 to a row in this list.
 *
 * This is the **public** model the desktop + renderer speak. The CDP events (flat,
 * one-per-event) are an internal implementation detail; the `NetworkRecorder` feeds
 * them in and emits these records.
 *
 * Timing: `requestTimestampMs` is mandatory; `responseTimestampMs` is set when a
 * `responseReceived` event lands; `endTimestampMs` is the last seen timestamp (response
 * or failure, or `loadingFinished`). `durationMs = endTimestampMs - requestTimestampMs`
 * is computed on the way out — single source of truth, no two ways to interpret it.
 */
export type HttpMethod =
  'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'CONNECT' | 'TRACE' | string; // unknown methods still pass through

export interface NetworkRecord {
  /** CDP's `requestId` — stable across the whole call. The correlation key. */
  readonly requestId: string;
  /** Final URL (response URL wins if it differs, but they almost always match). */
  readonly url: string;
  /** Method (upper-cased; CDP gives it as 'GET' / 'POST' / etc). */
  readonly method: HttpMethod;
  /** HTTP status code, if a response was received. */
  readonly status?: number;
  /** Status text from the response (e.g. 'OK', 'Not Found'). */
  readonly statusText?: string;
  /** Response content-type, if known. */
  readonly contentType?: string;
  /** Outgoing request headers. */
  readonly requestHeaders?: Readonly<Record<string, string>>;
  /** Incoming response headers. */
  readonly responseHeaders?: Readonly<Record<string, string>>;
  /** When the request was sent. */
  readonly requestTimestampMs: number;
  /** When the response headers arrived (TTFB endpoint). */
  readonly responseTimestampMs?: number;
  /** When the call ended: response arrival OR failure. `durationMs` is from this. */
  readonly endTimestampMs?: number;
  /** `Network.loadingFinished.encodedDataLength` — bytes on the wire (rough). */
  readonly encodedDataLength?: number;
  /** Error text from `Network.loadingFailed` (e.g. 'net::ERR_CANCELED'). */
  readonly failure?: string;
  /** `true` once the call is finished (response, failure, or both). */
  readonly ended: boolean;
}

function upperMethod(method: string | undefined): HttpMethod {
  if (method === undefined) return 'GET';
  return method.toUpperCase();
}

function isFiniteNumber(n: number | undefined): n is number {
  return n !== undefined && Number.isFinite(n);
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
  // `exactOptionalPropertyTypes` requires us to omit the key entirely when undefined;
  // this is the single point that enforces the on-the-wire shape.
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

/**
 * Take a flat list of CDP `CdpNetworkEvent`s and return the correlated `NetworkRecord[]`.
 * Pure: same input → same output; never throws. Defensive against:
 *   - missing `requestId` (event is dropped, not crashed on)
 *   - response before request (impossible in theory; we just don't get a URL)
 *   - duplicate events (last-write-wins for non-timestamp fields; timestamps accumulate
 *     because each event has its own meaning)
 *
 * The order of the output is **request-arrival order** (insertion order of the first
 * 'request' event for each `requestId`). This is what the UI wants to show — the most
 * natural mental model is "the order the calls left the app."
 */
export function aggregateNetworkEvents(events: readonly CdpNetworkEvent[]): NetworkRecord[] {
  const byId = new Map<string, MutableRecord>();
  const order: string[] = [];

  const upsert = (
    id: string,
    requestTimestamp: number,
    url: string,
    method: HttpMethod,
  ): MutableRecord => {
    let rec = byId.get(id);
    if (rec === undefined) {
      rec = {
        requestId: id,
        url,
        method,
        requestTimestampMs: requestTimestamp,
        ended: false,
      };
      byId.set(id, rec);
      order.push(id);
    } else {
      // A late 'request' event shouldn't override a response URL (rare, but possible —
      // e.g. a redirect that lands as a new request). Prefer the response URL; fall
      // back to the request URL.
      if (rec.url === '' && url !== '') rec.url = url;
    }
    return rec;
  };

  for (const ev of events) {
    if (!ev.requestId) continue; // defensive: drop frames without a stable id
    switch (ev.kind) {
      case 'request': {
        upsert(ev.requestId, ev.timestampMs, ev.url ?? '', upperMethod(ev.method));
        const rec = byId.get(ev.requestId);
        if (rec === undefined) break; // never happens; upsert guarantees it
        if (ev.requestHeaders !== undefined) rec.requestHeaders = ev.requestHeaders;
        break;
      }
      case 'response': {
        // If we never saw a 'request' (theoretical), we still want a record; the URL
        // may be on the response itself.
        const rec = upsert(
          ev.requestId,
          ev.timestampMs, // best-effort fallback; will be overwritten if a request event lands
          ev.url ?? '',
          upperMethod(ev.method),
        );
        rec.responseTimestampMs = ev.timestampMs;
        rec.endTimestampMs = ev.timestampMs;
        if (ev.url) rec.url = ev.url;
        if (ev.method) rec.method = upperMethod(ev.method);
        if (isFiniteNumber(ev.status)) rec.status = ev.status;
        if (ev.statusText) rec.statusText = ev.statusText;
        if (ev.contentType) rec.contentType = ev.contentType;
        if (ev.responseHeaders !== undefined) rec.responseHeaders = ev.responseHeaders;
        rec.ended = true;
        break;
      }
      case 'failed': {
        const rec = upsert(ev.requestId, ev.timestampMs, ev.url ?? '', upperMethod(ev.method));
        rec.endTimestampMs = ev.timestampMs;
        if (ev.errorText) rec.failure = ev.errorText;
        rec.ended = true;
        break;
      }
      case 'finished': {
        const rec = byId.get(ev.requestId);
        if (rec === undefined) break; // 'finished' without any prior event; drop
        // `loadingFinished` is a body-arrival signal, not a status signal. It always
        // comes after `responseReceived` in the happy path, and never in the failed
        // path. We only update the size + end timestamp (the response's end wins if
        // it's later — defensive).
        if (isFiniteNumber(ev.encodedDataLength)) rec.encodedDataLength = ev.encodedDataLength;
        const ts = ev.timestampMs;
        if (rec.endTimestampMs === undefined || ts > rec.endTimestampMs) {
          rec.endTimestampMs = ts;
        }
        rec.ended = true;
        break;
      }
    }
  }

  return order.map((id) => {
    const rec = byId.get(id);
    if (rec === undefined) {
      // Unreachable: `order` is only pushed in `upsert`. Belt-and-braces.
      throw new Error(`aggregateNetworkEvents: stale order entry for ${id}`);
    }
    return freeze(rec);
  });
}

/** A small, useful helper for the UI: wall-clock duration in ms, or null when not ended. */
export function durationMs(record: NetworkRecord): number | null {
  if (record.endTimestampMs === undefined) return null;
  return Math.max(0, record.endTimestampMs - record.requestTimestampMs);
}

/** Time-to-first-byte: response arrival minus request start, or null when no response. */
export function ttfbMs(record: NetworkRecord): number | null {
  if (record.responseTimestampMs === undefined) return null;
  return Math.max(0, record.responseTimestampMs - record.requestTimestampMs);
}
