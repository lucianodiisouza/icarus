/**
 * The in-app bridge poller (OQ-22 — the live-push half of the M3 perf/nav story).
 *
 * The M3 read-only inspectors (E-19 perf, E-20 nav) already work: the user pastes
 * a one-liner into their app that publishes state to `globalThis.__ICARUS_*__`,
 * and Icarus pulls it on click via `Runtime.evaluate`. This module is the
 * live-push upgrade: a periodic re-evaluate of the same expression, with a
 * JSON-equality diff against the previous value, so a renderer can subscribe to
 * a stream of snapshots without polling from the UI.
 *
 * Design (deliberately minimal):
 *   - The poller is a per-bridge instance: it holds a `CdpSendLike`, an
 *     expression, a poll interval, and a `previous` snapshot.
 *   - `start()` fires one immediate probe, then a `setInterval` tick.
 *   - Each tick evaluates the expression via `evaluateOnTarget`; on success the
 *     raw value is JSON-stringified and compared to `previous`. On any change,
 *     `onUpdate` fires with the new value AND the new "previous". Identical
 *     ticks are silent (no renderer churn).
 *   - Failures (timeout, cdp_error, no_bridge) surface through `onError` and
 *     DO NOT stop the poll — a transient CDP drop is recoverable. The first
 *     `not_connected` after `start()` does fire `onError` once so the UI knows
 *     the live push is dead.
 *   - `stop()` is idempotent. After stop, `start()` is allowed again (so the
 *     user can pause/resume).
 *
 * The poller is pure core (no Electron, no `setInterval` injection in the
 * minimal slice — see TD-XX for the injectable clock follow-up if needed). The
 * tick `setInterval` is the only side effect; for v1 the user accepts that
 * tests use a fake `setInterval` via a small `BridgePollerDeps` hook (see the
 * test file).
 */
import { evaluateOnTarget, type CdpSendLike, type EvaluateResult } from '../cdp/eval.js';

/**
 * The probe expression. The expression is evaluated verbatim in the running app's
 * JS context, and is expected to return one of:
 *   - The value the user wants to publish (object / array / primitive). The
 *     poller will JSON-stringify it and diff against the previous value.
 *   - `{ ok: false, kind: 'no_bridge' }` if the app hasn't published the
 *     `globalThis.__ICARUS_*__` key yet.
 * Anything else (thrown exception, invalid response) is surfaced as `onError`.
 */
export interface BridgePollerDeps<T> {
  /**
   * The current CDP sender, or a getter returning it. Read on every tick so a
   * connect/disconnect swap is picked up without restarting the poller. Pass
   * the value form for tests where the sender is fixed for the whole run.
   */
  readonly cdp: CdpSendLike | null | (() => CdpSendLike | null);
  /** The expression to evaluate (the user-installed one-liner). */
  readonly expression: string;
  /** Tick interval in ms (default 1000). */
  readonly intervalMs?: number;
  /** How long each `Runtime.evaluate` may take before it counts as a timeout (default 1500). */
  readonly evaluateTimeoutMs?: number;
  /**
   * Optional injectable scheduler. In production leave this undefined and the
   * poller uses `setInterval` + `clearInterval`. Tests use this to drive ticks
   * deterministically without real timers.
   */
  readonly scheduler?: BridgePollerScheduler;
  /** Fired with the new value when the polled result differs from the previous. */
  readonly onUpdate: (value: T) => void;
  /** Fired on a typed failure (timeout / cdp / not_connected / no_bridge). */
  readonly onError: (error: BridgePollerError) => void;
}

/** Minimal scheduler seam so tests can drive ticks synchronously. */
export interface BridgePollerScheduler {
  setInterval(handler: () => void, ms: number): { readonly id: number; clear(): void };
  clearInterval(handle: { readonly id: number; clear(): void }): void;
}

export type BridgePollerError =
  | { readonly kind: 'not_connected' }
  | { readonly kind: 'no_bridge' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cdp_error'; readonly message: string }
  | { readonly kind: 'remote_exception'; readonly name: string; readonly message: string }
  | { readonly kind: 'invalid_response'; readonly reason: string };

interface NoBridgeMarker {
  readonly ok: false;
  readonly kind: 'no_bridge';
}

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_EVALUATE_TIMEOUT_MS = 1500;

export class BridgePoller<T = unknown> {
  readonly #deps: BridgePollerDeps<T>;
  readonly #intervalMs: number;
  readonly #evaluateTimeoutMs: number;
  readonly #scheduler: BridgePollerScheduler;
  #handle: { readonly id: number; clear(): void } | null = null;
  #previous: string | null = null; // JSON-stringified last-seen value, or null if never seen
  #running = false;
  #inflight = false;

  constructor(deps: BridgePollerDeps<T>) {
    this.#deps = deps;
    this.#intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.#evaluateTimeoutMs = deps.evaluateTimeoutMs ?? DEFAULT_EVALUATE_TIMEOUT_MS;
    this.#scheduler = deps.scheduler ?? defaultScheduler();
  }

  /** Whether the poller is currently firing ticks. */
  get running(): boolean {
    return this.#running;
  }

  /** Begin polling. Idempotent (a second call is a no-op). */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#previous = null;
    void this.#tick();
    this.#handle = this.#scheduler.setInterval(() => void this.#tick(), this.#intervalMs);
  }

  /** Stop polling. Idempotent. */
  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#handle !== null) {
      this.#scheduler.clearInterval(this.#handle);
      this.#handle = null;
    }
    this.#previous = null;
  }

  /** Read the JSON-stringified last seen value (or null if never seen / just stopped). */
  get previousJson(): string | null {
    return this.#previous;
  }

  /** Resolve the current CDP sender (the deps field may be a value or a getter). */
  #currentCdp(): CdpSendLike | null {
    const c = this.#deps.cdp;
    if (typeof c === 'function') return c();
    return c;
  }

  async #tick(): Promise<void> {
    if (!this.#running) return;
    if (this.#inflight) return; // skip if a previous tick is still in flight
    const cdp = this.#currentCdp();
    if (cdp === null) {
      this.#deps.onError({ kind: 'not_connected' });
      return;
    }
    this.#inflight = true;
    try {
      const result: EvaluateResult<T | NoBridgeMarker> = await evaluateOnTarget<T | NoBridgeMarker>(
        cdp,
        this.#deps.expression,
        { timeoutMs: this.#evaluateTimeoutMs },
      );
      if (!result.ok) {
        this.#deps.onError(mapEvalFailure(result));
        return;
      }
      const value = result.value;
      if (isNoBridgeMarker(value)) {
        this.#deps.onError({ kind: 'no_bridge' });
        return;
      }
      // JSON-equality diff: cheap, predictable, and matches what the renderer
      // will see (objects stringify deterministically modulo key order, which
      // we control for by going through the same stringifier both sides).
      let serialized: string;
      try {
        serialized = JSON.stringify(value) ?? 'null';
      } catch (e) {
        this.#deps.onError({
          kind: 'invalid_response',
          reason: e instanceof Error ? e.message : 'unserializable',
        });
        return;
      }
      if (serialized !== this.#previous) {
        this.#previous = serialized;
        this.#deps.onUpdate(value as T);
      }
    } finally {
      this.#inflight = false;
    }
  }
}

function isNoBridgeMarker(v: unknown): v is NoBridgeMarker {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as { ok?: unknown; kind?: unknown };
  return obj.ok === false && obj.kind === 'no_bridge';
}

function mapEvalFailure<R>(raw: Extract<EvaluateResult<R>, { ok: false }>): BridgePollerError {
  switch (raw.kind) {
    case 'timeout':
      return { kind: 'timeout' };
    case 'remote_exception':
      return { kind: 'remote_exception', name: raw.name, message: raw.message };
    case 'cdp_error':
      return { kind: 'cdp_error', message: raw.message };
  }
}

function defaultScheduler(): BridgePollerScheduler {
  return {
    setInterval(handler, ms) {
      const id = setInterval(handler, ms) as unknown as number;
      return { id, clear: () => clearInterval(id as unknown as NodeJS.Timeout) };
    },
    clearInterval(handle) {
      handle.clear();
    },
  };
}
