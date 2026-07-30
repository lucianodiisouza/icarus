import { evaluateOnTarget, type CdpSendLike, type EvaluateResult } from './eval.js';
import { getJsHeap, getJsMetrics, type JsHeapResult, type JsMetricsResult } from './perf.js';
import {
  RENDER_HOTSPOT_PROBE,
  type RenderHotspot,
  type RenderHotspotProbe,
} from './render-hotspots.js';

/**
 * The M3 performance inspector's typed snapshot (E-19). Composes the three
 * pieces of data — JS heap, JS metrics, render hot-spots — into a single
 * `PerfSnapshot` the renderer can render. Pure: never throws, every failure
 * is a typed `Result` variant.
 *
 * The recent-error count is intentionally NOT in this snapshot — it lives
 * in main (the unified log + assistant context know the recent error count)
 * and the renderer is free to ignore the field on the render side. The
 * desktop wiring is free to extend `PerfSnapshot` with that field.
 */

export type EvalFailure = Extract<EvaluateResult<unknown>, { ok: false }>;

export interface PerfSnapshot {
  readonly jsHeap: JsHeapResult;
  readonly jsMetrics: JsMetricsResult;
  readonly renderHotspots: RenderHotspotProbe;
  /** Optional extension point for the desktop wiring (e.g. recent error count). */
  readonly recentErrorCount?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

type RawProbeResponse = {
  readonly hotspots?: readonly { readonly name: string; readonly renders: number }[];
  readonly ok?: boolean;
  readonly kind?: string;
};

export async function takePerfSnapshot(cdp: CdpSendLike | null): Promise<PerfSnapshot> {
  if (cdp === null) {
    return {
      jsHeap: { supported: false, reason: 'not_connected' },
      jsMetrics: { supported: false, reason: 'not_connected' },
      renderHotspots: { ok: false, kind: 'no_fiber_root' },
    };
  }
  const [heap, metrics, hotspotsRaw] = await Promise.all([
    getJsHeap(cdp),
    getJsMetrics(cdp),
    evaluateOnTarget<RawProbeResponse>(cdp, RENDER_HOTSPOT_PROBE, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
    }),
  ]);
  let hotspots: RenderHotspotProbe;
  if (hotspotsRaw.ok) {
    const v = hotspotsRaw.value;
    if (v && typeof v === 'object' && v.ok === true && Array.isArray(v.hotspots)) {
      const list: RenderHotspot[] = v.hotspots.map((h) => ({
        name: h.name,
        renders: h.renders,
      }));
      hotspots = { ok: true, hotspots: list };
    } else {
      hotspots = { ok: false, kind: 'no_fiber_root' };
    }
  } else {
    hotspots = mapProbeFailure(hotspotsRaw);
  }
  return { jsHeap: heap, jsMetrics: metrics, renderHotspots: hotspots };
}

function mapProbeFailure(raw: EvalFailure): RenderHotspotProbe {
  switch (raw.kind) {
    case 'timeout':
      return { ok: false, kind: 'timeout' };
    case 'remote_exception':
      return {
        ok: false,
        kind: 'remote_exception',
        message: `${raw.name}: ${raw.message}`,
      };
    case 'cdp_error':
      return { ok: false, kind: 'cdp_error', message: raw.message };
  }
}
