import { describe, expect, it, vi } from 'vitest';
import {
  BridgePoller,
  type BridgePollerScheduler,
  type BridgePollerError,
} from './bridge-poller.js';
import type { CdpSendLike } from '../cdp/eval.js';

/**
 * Deterministic scheduler for tests: ticks are queued in a list and fired by
 * the test (`runTicks(n)`) instead of real timers. This is the only side effect
 * we need to inject; everything else is synchronous.
 */
function makeFakeScheduler(): BridgePollerScheduler & {
  readonly runTicks: (n: number) => Promise<void>;
} {
  const handlers: Array<() => void> = [];
  let nextId = 1;
  const handles = new Map<number, { id: number; clear(): void }>();
  return {
    setInterval(handler, _ms) {
      handlers.push(handler);
      const id = nextId++;
      const handle = {
        id,
        clear: () => {
          handlers.splice(handlers.indexOf(handler), 1);
          handles.delete(id);
        },
      };
      handles.set(id, handle);
      return handle;
    },
    clearInterval(handle) {
      handle.clear();
    },
    async runTicks(n: number) {
      const pumpMicrotasks = async () => {
        // Let the immediate tick (from start()) and the in-handler microtasks settle.
        for (let i = 0; i < 10; i += 1) {
          await Promise.resolve();
        }
      };
      for (let i = 0; i < n; i += 1) {
        // Snapshot because the handler may call stop() (which splices).
        const snapshot = handlers.slice();
        for (const h of snapshot) h();
        await pumpMicrotasks();
      }
      // Always pump once so a start()'s immediate tick has a chance to settle.
      await pumpMicrotasks();
    },
  };
}

interface FakeCdp {
  readonly cdp: CdpSendLike;
  readonly setNext: (response: { ok: true; value: unknown } | { throw: Error }) => void;
  readonly callCount: () => number;
}

function makeFakeCdp(): FakeCdp {
  let next: { kind: 'ok'; value: unknown } | { kind: 'throw'; error: Error } = {
    kind: 'ok',
    value: null,
  };
  let calls = 0;
  return {
    cdp: {
      send: vi.fn(async () => {
        calls += 1;
        if (next.kind === 'throw') throw next.error;
        return { result: { value: next.value } };
      }) as unknown as CdpSendLike['send'],
    },
    setNext(response) {
      if ('throw' in response) next = { kind: 'throw', error: response.throw };
      else next = { kind: 'ok', value: response.value };
    },
    callCount: () => calls,
  };
}

describe('BridgePoller', () => {
  it('fires onUpdate immediately on the first tick with the initial value', async () => {
    const sched = makeFakeScheduler();
    const cdp = makeFakeCdp();
    cdp.setNext({ ok: true, value: { screen: 'Home' } });
    const updates: unknown[] = [];
    const errors: BridgePollerError[] = [];
    const poller = new BridgePoller({
      cdp: cdp.cdp,
      expression: 'JSON.stringify(globalThis.__ICARUS_NAV_STATE__)',
      onUpdate: (v) => updates.push(v),
      onError: (e) => errors.push(e),
      scheduler: sched,
    });
    poller.start();
    // First tick fires synchronously from start(); microtask resolves the CDP promise.
    await sched.runTicks(0);
    expect(updates).toEqual([{ screen: 'Home' }]);
    expect(errors).toEqual([]);
    poller.stop();
  });

  it('suppresses onUpdate when the new value is JSON-equal to the previous', async () => {
    const sched = makeFakeScheduler();
    const cdp = makeFakeCdp();
    const poller = new BridgePoller({
      cdp: cdp.cdp,
      expression: 'x',
      onUpdate: vi.fn(),
      onError: vi.fn(),
      scheduler: sched,
    });
    cdp.setNext({ ok: true, value: { a: 1, b: [2, 3] } });
    poller.start();
    await sched.runTicks(0);
    cdp.setNext({ ok: true, value: { a: 1, b: [2, 3] } }); // identical
    await sched.runTicks(1);
    cdp.setNext({ ok: true, value: { a: 1, b: [2, 3] } });
    await sched.runTicks(1);
    // No onUpdate after the first one.
    expect(poller.previousJson).toBe(JSON.stringify({ a: 1, b: [2, 3] }));
    poller.stop();
  });

  it('fires onUpdate only when the value changes', async () => {
    const sched = makeFakeScheduler();
    const cdp = makeFakeCdp();
    const updates: unknown[] = [];
    const poller = new BridgePoller({
      cdp: cdp.cdp,
      expression: 'x',
      onUpdate: (v) => updates.push(v),
      onError: vi.fn(),
      scheduler: sched,
    });
    cdp.setNext({ ok: true, value: 1 });
    poller.start();
    await sched.runTicks(0);
    cdp.setNext({ ok: true, value: 1 });
    await sched.runTicks(1);
    cdp.setNext({ ok: true, value: 2 });
    await sched.runTicks(1);
    cdp.setNext({ ok: true, value: 2 });
    await sched.runTicks(1);
    cdp.setNext({ ok: true, value: 3 });
    await sched.runTicks(1);
    expect(updates).toEqual([1, 2, 3]);
    poller.stop();
  });

  it('fires onError({ kind: "no_bridge" }) when the app returns the no_bridge marker', async () => {
    const sched = makeFakeScheduler();
    const cdp = makeFakeCdp();
    const errors: BridgePollerError[] = [];
    const poller = new BridgePoller({
      cdp: cdp.cdp,
      expression: 'x',
      onUpdate: vi.fn(),
      onError: (e) => errors.push(e),
      scheduler: sched,
    });
    cdp.setNext({ ok: true, value: { ok: false, kind: 'no_bridge' } });
    poller.start();
    await sched.runTicks(0);
    expect(errors).toEqual([{ kind: 'no_bridge' }]);
    poller.stop();
  });

  it('fires onError({ kind: "not_connected" }) when cdp is null', async () => {
    const sched = makeFakeScheduler();
    const errors: BridgePollerError[] = [];
    const poller = new BridgePoller({
      cdp: null,
      expression: 'x',
      onUpdate: vi.fn(),
      onError: (e) => errors.push(e),
      scheduler: sched,
    });
    poller.start();
    await sched.runTicks(0);
    expect(errors).toEqual([{ kind: 'not_connected' }]);
  });

  it('continues polling after a transient CDP error', async () => {
    const sched = makeFakeScheduler();
    const cdp = makeFakeCdp();
    const errors: BridgePollerError[] = [];
    const updates: unknown[] = [];
    const poller = new BridgePoller({
      cdp: cdp.cdp,
      expression: 'x',
      onUpdate: (v) => updates.push(v),
      onError: (e) => errors.push(e),
      scheduler: sched,
    });
    cdp.setNext({ ok: true, value: 1 });
    poller.start();
    await sched.runTicks(0);
    cdp.setNext({ throw: new Error('socket dropped') });
    await sched.runTicks(1);
    cdp.setNext({ ok: true, value: 2 });
    await sched.runTicks(1);
    expect(errors.map((e) => e.kind)).toEqual(['cdp_error']);
    expect(updates).toEqual([1, 2]);
    poller.stop();
  });

  it('start() is idempotent (a second call does not schedule a second interval)', async () => {
    const sched = makeFakeScheduler();
    const cdp = makeFakeCdp();
    const poller = new BridgePoller({
      cdp: cdp.cdp,
      expression: 'x',
      onUpdate: vi.fn(),
      onError: vi.fn(),
      scheduler: sched,
    });
    cdp.setNext({ ok: true, value: 1 });
    poller.start();
    poller.start();
    poller.start();
    await sched.runTicks(0);
    // Only one tick was scheduled — the cdp was called exactly once (the immediate one).
    expect(cdp.callCount()).toBe(1);
    poller.stop();
  });

  it('stop() is idempotent and clears the interval', async () => {
    const sched = makeFakeScheduler();
    const cdp = makeFakeCdp();
    const poller = new BridgePoller({
      cdp: cdp.cdp,
      expression: 'x',
      onUpdate: vi.fn(),
      onError: vi.fn(),
      scheduler: sched,
    });
    cdp.setNext({ ok: true, value: 1 });
    poller.start();
    await sched.runTicks(0);
    poller.stop();
    poller.stop();
    expect(poller.running).toBe(false);
    expect(poller.previousJson).toBeNull();
    cdp.setNext({ ok: true, value: 2 });
    await sched.runTicks(3);
    // After stop, no more ticks fire — callCount is still 1 (the immediate one).
    expect(cdp.callCount()).toBe(1);
  });

  it('start() after stop() re-arms the poller cleanly', async () => {
    const sched = makeFakeScheduler();
    const cdp = makeFakeCdp();
    const updates: unknown[] = [];
    const poller = new BridgePoller({
      cdp: cdp.cdp,
      expression: 'x',
      onUpdate: (v) => updates.push(v),
      onError: vi.fn(),
      scheduler: sched,
    });
    cdp.setNext({ ok: true, value: 1 });
    poller.start();
    await sched.runTicks(0);
    poller.stop();
    cdp.setNext({ ok: true, value: 2 });
    poller.start();
    await sched.runTicks(0);
    expect(updates).toEqual([1, 2]);
    poller.stop();
  });

  it('skips a tick while a previous tick is still in flight (no overlap)', async () => {
    const sched = makeFakeScheduler();
    let resolveSend: (v: unknown) => void = () => {};
    const cdp: CdpSendLike = {
      send: vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            resolveSend = resolve as (v: unknown) => void;
          }),
      ) as unknown as CdpSendLike['send'],
    };
    const updates: unknown[] = [];
    const poller = new BridgePoller({
      cdp,
      expression: 'x',
      onUpdate: (v) => updates.push(v),
      onError: vi.fn(),
      scheduler: sched,
    });
    poller.start();
    await sched.runTicks(0);
    // First tick is in flight (we haven't called resolveSend).
    await sched.runTicks(1);
    // The second tick should be skipped (inflight), so the send was still called only once.
    expect(cdp.send).toHaveBeenCalledTimes(1);
    // Resolve the first tick and let the microtask chain finish.
    resolveSend({ result: { value: 42 } });
    await vi.waitFor(() => {
      expect(updates).toEqual([42]);
    });
    poller.stop();
  });
});
