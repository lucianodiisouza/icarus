import { describe, expect, it } from 'vitest';
import { createPerfController, registerPerfChannels } from './perf-controller.js';
import type { CdpSendLike } from '@icarus/core';
import { IpcRouter } from './ipc/router.js';
import { CHANNELS } from '../shared/ipc/contracts.js';

/**
 * E-19 performance controller tests. The hard rules:
 *   - the controller is the only thing the IPC channel talks to
 *   - the snapshot is composed from three independent CDP calls
 *   - a disconnected CDP send yields a typed "unsupported" / "no_fiber_root" — never a thrown error
 */

function makeSend(
  impl: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): CdpSendLike {
  return { send: impl as CdpSendLike['send'] };
}

describe('createPerfController — disconnected', () => {
  it('returns a typed "unsupported" snapshot when no CDP send is set', async () => {
    const c = createPerfController();
    const out = await c.snapshot();
    expect(out.jsHeap).toEqual({ supported: false, reason: 'not_connected' });
    expect(out.jsMetrics).toEqual({ supported: false, reason: 'not_connected' });
    expect(out.renderHotspots).toEqual({ ok: false, kind: 'no_fiber_root' });
  });
});

describe('createPerfController — happy path', () => {
  it('composes the three CDP calls into one snapshot', async () => {
    const c = createPerfController();
    c.setCdpSend(
      makeSend(async (m) => {
        if (m === 'Runtime.getHeapUsage') {
          return { result: { value: { usedSize: 100, totalSize: 200 } } };
        }
        if (m === 'Performance.getMetrics') {
          return { result: { value: [{ name: 'Timestamp', value: 1 }] } };
        }
        if (m === 'Runtime.evaluate') {
          return { result: { value: { ok: true, hotspots: [{ name: 'App', renders: 3 }] } } };
        }
        return {};
      }),
    );
    const out = await c.snapshot();
    expect(out.jsHeap).toEqual({ supported: true, used: 100, total: 200 });
    expect(out.jsMetrics).toEqual({ supported: true, metrics: [{ name: 'Timestamp', value: 1 }] });
    expect(out.renderHotspots).toEqual({
      ok: true,
      hotspots: [{ name: 'App', renders: 3 }],
    });
  });
});

describe('createPerfController — recentErrorCount extension', () => {
  it('passes through the recentErrorCount when the controller is built with one', async () => {
    const c = createPerfController({ recentErrorCount: () => 42 });
    const out = await c.snapshot();
    expect(out.recentErrorCount).toBe(42);
  });

  it('leaves the field undefined when the controller has no recentErrorCount getter', async () => {
    const c = createPerfController();
    const out = await c.snapshot();
    expect(out.recentErrorCount).toBeUndefined();
  });
});

describe('registerPerfChannels — IPC wiring', () => {
  it('routes the snapshot channel to the controller', async () => {
    const c = createPerfController();
    c.setCdpSend(
      makeSend(async (m) => {
        if (m === 'Runtime.getHeapUsage') {
          return { result: { value: { usedSize: 1, totalSize: 1 } } };
        }
        if (m === 'Performance.getMetrics') {
          return { result: { value: [] } };
        }
        if (m === 'Runtime.evaluate') {
          return { result: { value: { ok: true, hotspots: [] } } };
        }
        return {};
      }),
    );
    const router = new IpcRouter();
    registerPerfChannels({ router, controller: c });
    const out = await router.dispatch(CHANNELS.PERF_SNAPSHOT, undefined);
    expect(out).toMatchObject({
      jsHeap: { supported: true, used: 1, total: 1 },
      renderHotspots: { ok: true, hotspots: [] },
    });
  });

  it('returns a typed not-connected snapshot via the IPC channel', async () => {
    const c = createPerfController();
    const router = new IpcRouter();
    registerPerfChannels({ router, controller: c });
    const out = await router.dispatch(CHANNELS.PERF_SNAPSHOT, undefined);
    expect(out).toMatchObject({
      jsHeap: { supported: false },
      renderHotspots: { ok: false, kind: 'no_fiber_root' },
    });
  });
});
