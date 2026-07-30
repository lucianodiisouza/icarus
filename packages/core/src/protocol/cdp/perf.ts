/**
 * The M3 performance inspector's CDP wrappers (E-19). Pure wrappers that
 * turn `Runtime.getHeapUsage` and `Performance.getMetrics` into typed results.
 * Mirrors the body-fetch / eval wrappers (E-16/E-17): never throws, surfaces
 * every failure as a typed `Result` variant.
 *
 * Why these two and not more: `Runtime.getHeapUsage` is the one JS-side memory
 * primitive the CDP exposes; `Performance.getMetrics` is the standard
 * performance metrics bundle (timestamps, gc events, etc.). Anything more
 * (FPS, native frame timing) needs the in-app bridge (OQ-22) — explicitly
 * out of scope for v1.
 */

import type { CdpSendLike } from './network-body.js';

export interface JsHeapUsage {
  readonly supported: true;
  readonly used: number;
  readonly total: number;
  /** Optional cap (some VMs report it). */
  readonly limit?: number;
}

export type JsHeapResult = JsHeapUsage | { readonly supported: false; readonly reason: string };

export interface JsMetricEntry {
  readonly name: string;
  readonly value: number;
}

export type JsMetricsResult =
  | { readonly supported: true; readonly metrics: readonly JsMetricEntry[] }
  | { readonly supported: false; readonly reason: string };

const DEFAULT_TIMEOUT_MS = 5_000;

interface RawHeapResponse {
  readonly result?: {
    readonly value?:
      | {
          readonly usedSize?: number;
          readonly totalSize?: number;
          readonly usage?: {
            readonly usedSize?: number;
            readonly totalSize?: number;
            readonly limit?: number;
          };
        }
      | { readonly usedSize?: number; readonly totalSize?: number };
  };
}

interface RawMetricsResponse {
  readonly result?: {
    readonly value?: readonly { readonly name: string; readonly value: number }[];
  };
}

class CallTimeout extends Error {
  constructor() {
    super('CDP perf call timed out');
    this.name = 'CallTimeout';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new CallTimeout()), ms);
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

/**
 * `Runtime.getHeapUsage` — a one-line call that returns the V8/JS heap usage.
 * Some Hermes versions don't support this method; we surface that as
 * `{ supported: false, reason: 'no_heap_method' }` rather than crashing.
 */
export async function getJsHeap(cdp: CdpSendLike): Promise<JsHeapResult> {
  try {
    const raw = await withTimeout(
      cdp.send<RawHeapResponse>('Runtime.getHeapUsage'),
      DEFAULT_TIMEOUT_MS,
    );
    const v = raw.result?.value;
    if (v === undefined || v === null) {
      return { supported: false, reason: 'no_heap_method' };
    }
    // Two shapes: `{ usedSize, totalSize }` directly, or `{ usage: { ... } }`.
    const used =
      (v as { usedSize?: number }).usedSize ??
      (v as { usage?: { usedSize?: number } }).usage?.usedSize;
    const total =
      (v as { totalSize?: number }).totalSize ??
      (v as { usage?: { totalSize?: number } }).usage?.totalSize;
    if (typeof used !== 'number' || typeof total !== 'number') {
      return { supported: false, reason: 'no_heap_method' };
    }
    const limit = (v as { usage?: { limit?: number } }).usage?.limit;
    const base: JsHeapUsage = { supported: true, used, total };
    return typeof limit === 'number' ? { ...base, limit } : base;
  } catch {
    return { supported: false, reason: 'unsupported' };
  }
}

/**
 * `Performance.getMetrics` — returns the current set of performance metrics.
 * Each metric is `{ name, value }`. We pass them through unchanged; the renderer
 * picks which ones to display.
 */
export async function getJsMetrics(cdp: CdpSendLike): Promise<JsMetricsResult> {
  try {
    const raw = await withTimeout(
      cdp.send<RawMetricsResponse>('Performance.getMetrics'),
      DEFAULT_TIMEOUT_MS,
    );
    const v = raw.result?.value;
    if (!Array.isArray(v)) {
      return { supported: false, reason: 'no_metrics_method' };
    }
    return { supported: true, metrics: v };
  } catch {
    return { supported: false, reason: 'unsupported' };
  }
}
