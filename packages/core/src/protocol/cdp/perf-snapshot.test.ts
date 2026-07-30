import { describe, expect, it } from 'vitest';
import { takePerfSnapshot } from './perf-snapshot.js';
import { getJsHeap, getJsMetrics } from './perf.js';
import type { CdpSendLike } from './network-body.js';

/**
 * E-19 performance inspector tests. The hard rules:
 *   - the snapshot is composed from three independent calls (heap, metrics, hotspots)
 *   - a disconnected CDP send yields a typed "unsupported" / "no_fiber_root" for all
 *     three — never a thrown error
 *   - the renderer is the only consumer; we never mutate the app
 */

function makeSend(
  impl: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): CdpSendLike {
  return { send: impl as CdpSendLike['send'] };
}

describe('getJsHeap — happy path', () => {
  it('returns the typed result on a supported response', async () => {
    const cdp = makeSend(async (m) => {
      expect(m).toBe('Runtime.getHeapUsage');
      return { result: { value: { usedSize: 1234, totalSize: 5678 } } };
    });
    const out = await getJsHeap(cdp);
    expect(out).toEqual({ supported: true, used: 1234, total: 5678 });
  });

  it('passes through the optional limit when present', async () => {
    const cdp = makeSend(async () => ({
      result: { value: { usage: { usedSize: 1, totalSize: 2, limit: 100 } } },
    }));
    const out = await getJsHeap(cdp);
    expect(out).toEqual({ supported: true, used: 1, total: 2, limit: 100 });
  });
});

describe('getJsHeap — typed failure paths', () => {
  it('returns supported: false when the response has no value', async () => {
    const cdp = makeSend(async () => ({ result: {} }));
    const out = await getJsHeap(cdp);
    expect(out).toEqual({ supported: false, reason: 'no_heap_method' });
  });

  it('returns supported: false when the value is missing usedSize/totalSize', async () => {
    const cdp = makeSend(async () => ({ result: { value: { usedSize: 1 } } }));
    const out = await getJsHeap(cdp);
    expect(out).toEqual({ supported: false, reason: 'no_heap_method' });
  });

  it('returns supported: false on a CDP error (no throw)', async () => {
    const cdp = makeSend(async () => {
      throw new Error('protocol boom');
    });
    const out = await getJsHeap(cdp);
    expect(out).toEqual({ supported: false, reason: 'unsupported' });
  });
});

describe('getJsMetrics — happy path', () => {
  it('returns the typed list on a supported response', async () => {
    const cdp = makeSend(async (m) => {
      expect(m).toBe('Performance.getMetrics');
      return {
        result: {
          value: [
            { name: 'Timestamp', value: 1234 },
            { name: 'JsHeapUsedSize', value: 5678 },
          ],
        },
      };
    });
    const out = await getJsMetrics(cdp);
    expect(out).toEqual({
      supported: true,
      metrics: [
        { name: 'Timestamp', value: 1234 },
        { name: 'JsHeapUsedSize', value: 5678 },
      ],
    });
  });
});

describe('getJsMetrics — typed failure paths', () => {
  it('returns supported: false on a non-array value', async () => {
    const cdp = makeSend(async () => ({ result: { value: 'oops' } }));
    const out = await getJsMetrics(cdp);
    expect(out).toEqual({ supported: false, reason: 'no_metrics_method' });
  });

  it('returns supported: false on a CDP error (no throw)', async () => {
    const cdp = makeSend(async () => {
      throw new Error('boom');
    });
    const out = await getJsMetrics(cdp);
    expect(out).toEqual({ supported: false, reason: 'unsupported' });
  });
});

describe('takePerfSnapshot — disconnected', () => {
  it('returns a typed "not connected" snapshot for all three fields', async () => {
    const out = await takePerfSnapshot(null);
    expect(out.jsHeap).toEqual({ supported: false, reason: 'not_connected' });
    expect(out.jsMetrics).toEqual({ supported: false, reason: 'not_connected' });
    expect(out.renderHotspots).toEqual({ ok: false, kind: 'no_fiber_root' });
  });
});

describe('takePerfSnapshot — composed happy path', () => {
  it('composes all three pieces into one typed result', async () => {
    const cdp = makeSend(async (m) => {
      if (m === 'Runtime.getHeapUsage') {
        return { result: { value: { usedSize: 100, totalSize: 200 } } };
      }
      if (m === 'Performance.getMetrics') {
        return { result: { value: [{ name: 'Timestamp', value: 1 }] } };
      }
      if (m === 'Runtime.evaluate') {
        return {
          result: {
            value: { ok: true, hotspots: [{ name: 'App', renders: 3 }] },
          },
        };
      }
      return {};
    });
    const out = await takePerfSnapshot(cdp);
    expect(out.jsHeap).toEqual({ supported: true, used: 100, total: 200 });
    expect(out.jsMetrics).toEqual({ supported: true, metrics: [{ name: 'Timestamp', value: 1 }] });
    expect(out.renderHotspots).toEqual({
      ok: true,
      hotspots: [{ name: 'App', renders: 3 }],
    });
  });

  it('propagates a probe failure as a typed renderHotspots error', async () => {
    const cdp = makeSend(async (m) => {
      if (m === 'Runtime.getHeapUsage') {
        return { result: { value: { usedSize: 1, totalSize: 1 } } };
      }
      if (m === 'Performance.getMetrics') {
        return { result: { value: [] } };
      }
      if (m === 'Runtime.evaluate') {
        return {
          exceptionDetails: {
            exception: { className: 'TypeError', description: 'cannot find root' },
          },
        };
      }
      return {};
    });
    const out = await takePerfSnapshot(cdp);
    expect(out.jsHeap).toEqual({ supported: true, used: 1, total: 1 });
    expect(out.renderHotspots.ok).toBe(false);
    if (out.renderHotspots.ok) return;
    expect(out.renderHotspots.kind).toBe('remote_exception');
  });
});
