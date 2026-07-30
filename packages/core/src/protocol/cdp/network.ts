/**
 * Turns CDP `Network.*` events into normalized network records (E-14, slice 5; extended in
 * E-16 for the network-inspector upgrade). The spike proved that RN ≥ 0.76 supports the
 * Network domain natively through Hermes, so we get request/response capture for free once
 * `Network.enable` succeeds. Pure and Electron-free (ADR-0002).
 *
 * Events we care about:
 *  - `requestWillBeSent`           — a request is going out (with headers + postData)
 *  - `responseReceived`            — response headers are back (with headers + status)
 *  - `loadingFailed`               — the request failed (DNS, CORS, cancel, etc.)
 *  - `loadingFinished`             — body is fully received (we use it for `endTimestampMs`
 *                                    and an approximate body size; v1 does NOT auto-fetch
 *                                    the body — bodies are opt-in via the inspector UI)
 *
 * The flat event list is then **correlated into `NetworkRecord`s** by the `NetworkRecorder`
 * (see `core/protocol/network/recorder.ts`) keyed on the stable `requestId`. That's the
 * M3 inspector's source of truth — one row per HTTP call, not per event.
 */

/** The CDP Network event names we subscribe to. */
export const NETWORK_EVENTS = {
  REQUEST_WILL_BE_SENT: 'Network.requestWillBeSent',
  RESPONSE_RECEIVED: 'Network.responseReceived',
  LOADING_FAILED: 'Network.loadingFailed',
  LOADING_FINISHED: 'Network.loadingFinished',
} as const;

export type CdpNetworkEventKind = 'request' | 'response' | 'failed' | 'finished';

export interface CdpNetworkEvent {
  readonly kind: CdpNetworkEventKind;
  readonly requestId: string;
  readonly timestampMs: number;
  // Request fields (present in 'request' and 'response' / 'failed' / 'finished' kinds)
  readonly url?: string;
  readonly method?: string;
  // Request headers (present in 'request' / 'response' kinds)
  readonly requestHeaders?: Readonly<Record<string, string>>;
  // Response fields (present in 'response' only)
  readonly status?: number;
  readonly statusText?: string;
  readonly contentType?: string;
  // Response headers (present in 'response' kind)
  readonly responseHeaders?: Readonly<Record<string, string>>;
  // Body size from loadingFinished (encodedDataLength)
  readonly encodedDataLength?: number;
  // Failure fields (present in 'failed' only)
  readonly errorText?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asHeaderObject(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v;
  }
  // Empty object → undefined; we don't want to keep an empty headers map on the event.
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Build a record that only includes a field when its value is defined — required because
 * the project uses `exactOptionalPropertyTypes`, which distinguishes "field absent" from
 * "field present with value undefined" and refuses to coerce between them.
 */
function defined<T extends Record<string, unknown>>(
  record: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v !== undefined) out[k] = v;
  }
  return out as { [K in keyof T]: Exclude<T[K], undefined> };
}

function timestampOf(params: Record<string, unknown>, now: () => number): number {
  return asNumber(params['timestamp']) ?? now();
}

/**
 * Parse a CDP Network event into a CdpNetworkEvent, or null if the shape is unexpected.
 * The CDP method name drives `kind`: request / response / failed / finished. We never
 * throw — bad frames are dropped, not crashed on (mirrors `formatConsoleEvent` discipline).
 */
export function formatNetworkEvent(
  method: string,
  params: unknown,
  now: () => number = Date.now,
): CdpNetworkEvent | null {
  if (!isRecord(params)) return null;
  const requestId = asString(params['requestId']);
  if (!requestId) return null;
  const timestampMs = timestampOf(params, now);

  if (method === NETWORK_EVENTS.REQUEST_WILL_BE_SENT) {
    const request = isRecord(params['request']) ? params['request'] : undefined;
    return defined({
      kind: 'request' as const,
      requestId,
      timestampMs,
      url: asString(request?.['url']),
      method: asString(request?.['method']),
      requestHeaders: asHeaderObject(request?.['headers']),
    });
  }

  if (method === NETWORK_EVENTS.RESPONSE_RECEIVED) {
    const response = isRecord(params['response']) ? params['response'] : undefined;
    return defined({
      kind: 'response' as const,
      requestId,
      timestampMs,
      url: asString(response?.['url']),
      method: asString(response?.['requestMethod']),
      status: asNumber(response?.['status']),
      statusText: asString(response?.['statusText']),
      contentType: asString(response?.['mimeType']),
      responseHeaders: asHeaderObject(response?.['headers']),
    });
  }

  if (method === NETWORK_EVENTS.LOADING_FAILED) {
    return defined({
      kind: 'failed' as const,
      requestId,
      timestampMs,
      errorText: asString(params['errorText']),
    });
  }

  if (method === NETWORK_EVENTS.LOADING_FINISHED) {
    return defined({
      kind: 'finished' as const,
      requestId,
      timestampMs,
      encodedDataLength: asNumber(params['encodedDataLength']),
    });
  }

  return null;
}
