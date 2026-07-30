/**
 * The M3 network inspector's body-fetch wrapper (E-16, T-16.3). CDP has two
 * request/response body primitives, both round-trips to the JS context:
 *
 *   - `Network.getRequestPostData({ requestId })` → `{ postData: string }`
 *   - `Network.getResponseBody({ requestId })`    → `{ body: string, base64Encoded: boolean }`
 *
 * Both can be slow on a busy app, and `getResponseBody` can fail (e.g. the response
 * was already GC'd, or it's not text-encodable). This module:
 *
 *   - Wraps both with a strict size cap (default 256 KB) and a clear error shape.
 *   - Treats binary bodies (`base64Encoded: true`) as "unavailable" in v1 — we don't
 *     surface image bytes in the inspector. The `contentType` and `encodedDataLength`
 *     on the record are enough.
 *   - Never throws — surfaces a typed `NetworkBodyUnavailable` so the renderer can
 *     show "body unavailable" rather than crash.
 *
 * Pure wrappper around the CDP client: takes a `send` function and a `requestId`,
 * returns a `NetworkBodyResult`. No Electron, no state, no side effects beyond the
 * CDP round-trip.
 */

export interface NetworkBodyResult {
  /** The body as a UTF-8 string, or `null` if the body could not be fetched. */
  readonly body: string | null;
  /** True if the body was available but the inspector chose not to surface it (e.g. binary). */
  readonly skipped: boolean;
  /**
   * Why the body is not available, when it isn't. One of:
   *  - 'too-large'        — over the size cap
   *  - 'binary'           — the response was base64-encoded (image, video, etc.)
   *  - 'not-fetchable'    — the CDP call returned an error (response GC'd, etc.)
   *  - 'timeout'          — the CDP call exceeded the timeout
   */
  readonly reason?: 'too-large' | 'binary' | 'not-fetchable' | 'timeout';
  /** Bytes on the wire (rough; from `loadingFinished.encodedDataLength`), when known. */
  readonly approxBytes?: number;
}

export interface NetworkBodyOptions {
  /** Cap on the body size in bytes (default 256 KB). Bodies above this are skipped. */
  readonly maxBytes?: number;
  /**
   * Timeout for the CDP round-trip in ms (default 5000). The inspector UI is
   * synchronous-from-the-user's-POV; a stuck body fetch must not block the panel.
   */
  readonly timeoutMs?: number;
}

/** Minimal CDP `send` shape — keeps the wrapper testable with a fake. The `R` generic
 *  matches the real `CdpClient.send` shape; callers that pass a fake can use `unknown`. */
export interface CdpSendLike {
  send<R = unknown>(method: string, params?: Record<string, unknown>): Promise<R>;
}

const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Fetch the **request post-data** (request body) for a `requestId`. Returns
 * `body: null` with `reason: 'not-fetchable'` if CDP rejects (e.g. the request had
 * no body, or the call failed).
 */
export async function fetchRequestBody(
  send: CdpSendLike,
  requestId: string,
  options: NetworkBodyOptions = {},
): Promise<NetworkBodyResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const result = await withTimeout(
      send.send<{ postData?: string }>('Network.getRequestPostData', { requestId }),
      timeoutMs,
    );
    const body = result.postData;
    if (body === undefined || body === '') {
      return { body: null, skipped: false };
    }
    if (byteLength(body) > maxBytes) {
      return { body: null, skipped: true, reason: 'too-large' };
    }
    return { body, skipped: false };
  } catch (err) {
    return rejectToBodyResult(err);
  }
}

/**
 * Fetch the **response body** for a `requestId`. Binary responses (`base64Encoded`)
 * are skipped (the inspector shows `contentType` + size, not bytes).
 */
export async function fetchResponseBody(
  send: CdpSendLike,
  requestId: string,
  options: NetworkBodyOptions = {},
): Promise<NetworkBodyResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const result = await withTimeout(
      send.send<{ body?: string; base64Encoded?: boolean }>('Network.getResponseBody', {
        requestId,
      }),
      timeoutMs,
    );
    if (result.base64Encoded === true) {
      return { body: null, skipped: true, reason: 'binary' };
    }
    const body = result.body ?? '';
    if (body === '') {
      return { body: null, skipped: false };
    }
    if (byteLength(body) > maxBytes) {
      return { body: null, skipped: true, reason: 'too-large' };
    }
    return { body, skipped: false };
  } catch (err) {
    return rejectToBodyResult(err);
  }
}

function rejectToBodyResult(err: unknown): NetworkBodyResult {
  if (err instanceof NetworkBodyTimeoutError) {
    return { body: null, skipped: false, reason: 'timeout' };
  }
  // CDP errors land here as `{ code, message }` from the protocol layer; we don't
  // surface the message to the renderer (defensive). 'not-fetchable' is the right
  // honest answer for any protocol-level failure.
  return { body: null, skipped: false, reason: 'not-fetchable' };
}

class NetworkBodyTimeoutError extends Error {
  constructor() {
    super('Network body fetch timed out');
    this.name = 'NetworkBodyTimeoutError';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new NetworkBodyTimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function byteLength(s: string): number {
  // TextEncoder is available in Node 18+ and modern browsers; the inspector is
  // desktop-only, so this is safe.
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s).length;
  }
  // Best-effort fallback (rough, but correct for the "is it over the cap?" question).
  return s.length;
}
