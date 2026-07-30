/**
 * The live in-app bridge (OQ-22, E-22 follow-up). Owns the two `BridgePoller`
 * instances the user can opt into: a nav poller and a perf hot-spots poller.
 * Each runs a `Runtime.evaluate` on an interval, JSON-diffing the result against
 * the previous value, and emits a delta to subscribers when it changes.
 *
 * The user installs a one-liner in their app (the same globalThis publish used
 * by the read-only E-19/E-20 inspectors); this controller is the live-push
 * upgrade on top of that bridge.
 */
import { EventEmitter } from 'node:events';
import {
  BridgePoller,
  type BridgePollerError,
  type BridgePollerScheduler,
  type CdpSendLike,
} from '@icarus/core';

/** The probe expression for the navigation state (matches E-20's read-only nav). */
const NAV_EXPRESSION =
  "(()=>{const v=globalThis.__ICARUS_NAV_STATE__;return v?{ok:true,state:v}:{ok:false,kind:'no_bridge'}})()";

/** The probe expression for render hot-spots (matches E-19's read-only perf). */
const PERF_HOTSPOTS_EXPRESSION =
  "(()=>{const v=globalThis.__ICARUS_PERF_HOTSPOTS__;return Array.isArray(v)?{ok:true,hotspots:v}:{ok:false,kind:'no_bridge'}})()";

export interface BridgeControllerDeps {
  /** The current CDP sender (or null if not connected). The getter is re-read
   *  on every tick so a connect/disconnect swap is picked up without restarting
   *  the controller. */
  readonly getCdp: () => CdpSendLike | null;
  /** Optional injectable scheduler (tests). */
  readonly scheduler?: BridgePollerScheduler;
  /** Tick interval in ms (default 1000). */
  readonly intervalMs?: number;
  /** Per-evaluate timeout in ms (default 1500). */
  readonly evaluateTimeoutMs?: number;
}

/** A typed delta from one of the pollers. */
export type BridgeDelta =
  | { readonly kind: 'nav'; readonly state: unknown }
  | { readonly kind: 'perf_hotspots'; readonly hotspots: readonly unknown[] };

/** A typed error from one of the pollers. */
export type BridgeError =
  | { readonly kind: 'nav'; readonly error: BridgePollerError }
  | { readonly kind: 'perf_hotspots'; readonly error: BridgePollerError };

export class BridgeController {
  readonly #deps: BridgeControllerDeps;
  readonly #events = new EventEmitter();
  #navPoller: BridgePoller<{ ok: true; state: unknown }> | null = null;
  #perfPoller: BridgePoller<{ ok: true; hotspots: readonly unknown[] }> | null = null;
  #disposed = false;

  constructor(deps: BridgeControllerDeps) {
    this.#deps = deps;
  }

  /** Start the nav poller. Idempotent. */
  startNav(): void {
    if (this.#disposed) return;
    if (this.#navPoller !== null) return;
    this.#navPoller = new BridgePoller<{ ok: true; state: unknown }>(
      this.#pollerDeps(
        NAV_EXPRESSION,
        (value) =>
          this.#events.emit('delta', { kind: 'nav', state: value.state } satisfies BridgeDelta),
        (error) => this.#events.emit('error', { kind: 'nav', error } satisfies BridgeError),
      ),
    );
    this.#navPoller.start();
  }

  /** Start the perf hot-spots poller. Idempotent. */
  startPerfHotspots(): void {
    if (this.#disposed) return;
    if (this.#perfPoller !== null) return;
    this.#perfPoller = new BridgePoller<{ ok: true; hotspots: readonly unknown[] }>(
      this.#pollerDeps(
        PERF_HOTSPOTS_EXPRESSION,
        (value) =>
          this.#events.emit('delta', {
            kind: 'perf_hotspots',
            hotspots: value.hotspots,
          } satisfies BridgeDelta),
        (error) =>
          this.#events.emit('error', { kind: 'perf_hotspots', error } satisfies BridgeError),
      ),
    );
    this.#perfPoller.start();
  }

  /** Build the deps object, omitting undefined optional fields so
   *  `exactOptionalPropertyTypes` is happy. */
  #pollerDeps<T>(
    expression: string,
    onUpdate: (v: T) => void,
    onError: (e: BridgePollerError) => void,
  ): import('@icarus/core').BridgePollerDeps<T> {
    return {
      cdp: this.#deps.getCdp,
      expression,
      onUpdate,
      onError,
      ...(this.#deps.intervalMs !== undefined ? { intervalMs: this.#deps.intervalMs } : {}),
      ...(this.#deps.evaluateTimeoutMs !== undefined
        ? { evaluateTimeoutMs: this.#deps.evaluateTimeoutMs }
        : {}),
      ...(this.#deps.scheduler !== undefined ? { scheduler: this.#deps.scheduler } : {}),
    };
  }

  /** Stop a single poller. Idempotent. */
  stopNav(): void {
    this.#navPoller?.stop();
    this.#navPoller = null;
  }

  stopPerfHotspots(): void {
    this.#perfPoller?.stop();
    this.#perfPoller = null;
  }

  /** Stop both pollers + drop all listeners. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.stopNav();
    this.stopPerfHotspots();
    this.#events.removeAllListeners();
  }

  /** Subscribe to deltas. Returns an unsubscribe. */
  onDelta(handler: (delta: BridgeDelta) => void): () => void {
    this.#events.on('delta', handler);
    return () => this.#events.off('delta', handler);
  }

  /** Subscribe to errors. Returns an unsubscribe. */
  onError(handler: (err: BridgeError) => void): () => void {
    this.#events.on('error', handler);
    return () => this.#events.off('error', handler);
  }

  /** Whether the nav poller is currently running. */
  get navRunning(): boolean {
    return this.#navPoller?.running ?? false;
  }

  /** Whether the perf hot-spots poller is currently running. */
  get perfHotspotsRunning(): boolean {
    return this.#perfPoller?.running ?? false;
  }
}
