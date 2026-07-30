/**
 * The M3 component tree inspector's `Runtime.evaluate` wrapper (E-17, T-17.1).
 *
 * CDP `Runtime.evaluate` is the one way to ask the running RN app a question
 * (any expression in the JS context). It returns:
 *   - `result` — the evaluated value (with `RemoteObject` shape, or plain JSON
 *     if `returnByValue: true`)
 *   - `exceptionDetails` — when the expression throws
 *
 * The wrapper:
 *   - Defaults to `returnByValue: true` (the inspector wants plain JSON, not
 *     RemoteObjects that would need a second round-trip to read properties).
 *   - Caps timeout (default 5s) so a stuck expression can't freeze the panel.
 *   - Surfaces both kinds of failure as typed `EvaluateError` variants —
 *     `timeout` vs `remote_exception` vs `cdp_error` — so the renderer can
 *     show the right "why this didn't work" message.
 *   - Never throws.
 *
 * Pure wrappper: takes a `CdpSendLike`, returns an `EvaluateResult<R>`. No
 * Electron, no state, no side effects beyond the CDP round-trip.
 */

import type { CdpSendLike } from './network-body.js';
export type { CdpSendLike } from './network-body.js';

export interface EvaluateOptions {
  /** Whether the result should be a plain JSON value (default true). */
  readonly returnByValue?: boolean;
  /** Cap on the CDP round-trip in ms (default 5000). */
  readonly timeoutMs?: number;
}

export type EvaluateResult<R> =
  /** The expression ran; here is the value. */
  | { readonly ok: true; readonly value: R }
  /** The expression ran but threw inside the JS context. */
  | {
      readonly ok: false;
      readonly kind: 'remote_exception';
      readonly name: string;
      readonly message: string;
    }
  /** The CDP round-trip exceeded the timeout. */
  | { readonly ok: false; readonly kind: 'timeout' }
  /** The CDP call itself failed (network, protocol error, etc.). */
  | { readonly ok: false; readonly kind: 'cdp_error'; readonly message: string };

interface RawEvaluateResponse {
  readonly result?: { readonly value?: unknown };
  readonly exceptionDetails?: {
    readonly exception?: { readonly description?: string; readonly className?: string };
    readonly text?: string;
  };
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Evaluate a JavaScript expression in the running app's JS context. Never throws —
 * the result is a discriminated union the caller pattern-matches on.
 */
export async function evaluateOnTarget<R = unknown>(
  cdp: CdpSendLike,
  expression: string,
  options: EvaluateOptions = {},
): Promise<EvaluateResult<R>> {
  const returnByValue = options.returnByValue ?? true;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const raw = await withTimeout(
      cdp.send<RawEvaluateResponse>('Runtime.evaluate', {
        expression,
        returnByValue,
        // The inspector is read-only; we never want side effects from a tree-walk eval.
        awaitPromise: false,
      }),
      timeoutMs,
    );
    if (raw.exceptionDetails) {
      const exc = raw.exceptionDetails.exception;
      return {
        ok: false,
        kind: 'remote_exception',
        name: exc?.className ?? 'Error',
        message: exc?.description ?? raw.exceptionDetails.text ?? 'unknown',
      };
    }
    return { ok: true, value: (raw.result?.value as R | undefined) ?? (undefined as unknown as R) };
  } catch (err) {
    if (err instanceof EvaluateTimeoutError) {
      return { ok: false, kind: 'timeout' };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: 'cdp_error', message };
  }
}

class EvaluateTimeoutError extends Error {
  constructor() {
    super('CDP evaluate timed out');
    this.name = 'EvaluateTimeoutError';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new EvaluateTimeoutError()), ms);
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
