import { describe, expect, it, vi } from 'vitest';
import { BridgeController, type BridgeDelta, type BridgeError } from './bridge-controller.js';
import type { BridgePollerScheduler } from '@icarus/core';
import type { CdpSendLike } from '@icarus/core';

function makeScheduler(): BridgePollerScheduler & { runTicks: (n: number) => Promise<void> } {
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
          const i = handlers.indexOf(handler);
          if (i >= 0) handlers.splice(i, 1);
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
      const pump = async () => {
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
      };
      for (let i = 0; i < n; i += 1) {
        const snapshot = handlers.slice();
        for (const h of snapshot) h();
        await pump();
      }
      await pump();
    },
  };
}

function makeFakeCdp(): {
  cdp: CdpSendLike;
  setNext: (value: unknown) => void;
  callCount: () => number;
} {
  let next: unknown = null;
  let calls = 0;
  return {
    cdp: {
      send: vi.fn(async () => {
        calls += 1;
        return { result: { value: next } };
      }) as unknown as CdpSendLike['send'],
    },
    setNext(value) {
      next = value;
    },
    callCount: () => calls,
  };
}

describe('BridgeController', () => {
  it('startNav() begins a poller; deltas are forwarded to onDelta subscribers', async () => {
    const sched = makeScheduler();
    const fake = makeFakeCdp();
    const controller = new BridgeController({
      getCdp: () => fake.cdp,
      scheduler: sched,
    });
    const deltas: BridgeDelta[] = [];
    controller.onDelta((d) => deltas.push(d));
    fake.setNext({ ok: true, state: { screen: 'Home' } });
    controller.startNav();
    await sched.runTicks(0);
    expect(deltas).toEqual([{ kind: 'nav', state: { screen: 'Home' } }]);
    controller.dispose();
  });

  it('reads getCdp on every tick (so a connect/disconnect swap is picked up)', async () => {
    const sched = makeScheduler();
    const fake1 = makeFakeCdp();
    const fake2 = makeFakeCdp();
    let current = fake1.cdp;
    const controller = new BridgeController({
      getCdp: () => current,
      scheduler: sched,
    });
    const deltas: BridgeDelta[] = [];
    controller.onDelta((d) => deltas.push(d));
    fake1.setNext({ ok: true, state: { a: 1 } });
    controller.startNav();
    await sched.runTicks(0);
    // Swap cdp mid-flight.
    current = fake2.cdp;
    fake2.setNext({ ok: true, state: { a: 2 } });
    await sched.runTicks(1);
    expect(deltas).toEqual([
      { kind: 'nav', state: { a: 1 } },
      { kind: 'nav', state: { a: 2 } },
    ]);
    expect(fake1.callCount()).toBe(1);
    expect(fake2.callCount()).toBe(1);
    controller.dispose();
  });

  it('startPerfHotspots() begins a poller; deltas are tagged perf_hotspots', async () => {
    const sched = makeScheduler();
    const fake = makeFakeCdp();
    const controller = new BridgeController({
      getCdp: () => fake.cdp,
      scheduler: sched,
    });
    const deltas: BridgeDelta[] = [];
    controller.onDelta((d) => deltas.push(d));
    fake.setNext({ ok: true, hotspots: [{ name: 'Foo', renders: 12 }] });
    controller.startPerfHotspots();
    await sched.runTicks(0);
    expect(deltas).toEqual([{ kind: 'perf_hotspots', hotspots: [{ name: 'Foo', renders: 12 }] }]);
    controller.dispose();
  });

  it('startNav() is idempotent (second call does not start a second poller)', async () => {
    const sched = makeScheduler();
    const fake = makeFakeCdp();
    const controller = new BridgeController({
      getCdp: () => fake.cdp,
      scheduler: sched,
    });
    fake.setNext({ ok: true, state: { a: 1 } });
    controller.startNav();
    controller.startNav();
    controller.startNav();
    await sched.runTicks(0);
    expect(fake.callCount()).toBe(1);
    controller.dispose();
  });

  it('errors are surfaced via onError with the originating poller tag', async () => {
    const sched = makeScheduler();
    const fake = makeFakeCdp();
    const controller = new BridgeController({
      getCdp: () => fake.cdp,
      scheduler: sched,
    });
    const errors: BridgeError[] = [];
    controller.onError((e) => errors.push(e));
    fake.setNext({ ok: false, kind: 'no_bridge' });
    controller.startNav();
    await sched.runTicks(0);
    expect(errors).toEqual([{ kind: 'nav', error: { kind: 'no_bridge' } }]);
    controller.dispose();
  });

  it('stopNav() stops the poller and a fresh startNav() re-arms it', async () => {
    const sched = makeScheduler();
    const fake = makeFakeCdp();
    const controller = new BridgeController({
      getCdp: () => fake.cdp,
      scheduler: sched,
    });
    const deltas: BridgeDelta[] = [];
    controller.onDelta((d) => deltas.push(d));
    fake.setNext({ ok: true, state: 1 });
    controller.startNav();
    await sched.runTicks(0);
    expect(controller.navRunning).toBe(true);
    controller.stopNav();
    expect(controller.navRunning).toBe(false);
    // No more ticks.
    fake.setNext({ ok: true, state: 2 });
    await sched.runTicks(3);
    expect(deltas).toEqual([{ kind: 'nav', state: 1 }]);
    // Re-arm.
    controller.startNav();
    await sched.runTicks(0);
    expect(deltas).toEqual([
      { kind: 'nav', state: 1 },
      { kind: 'nav', state: 2 },
    ]);
    controller.dispose();
  });

  it('dispose() stops both pollers and drops listeners', async () => {
    const sched = makeScheduler();
    const fake = makeFakeCdp();
    const controller = new BridgeController({
      getCdp: () => fake.cdp,
      scheduler: sched,
    });
    fake.setNext({ ok: true, state: 1 });
    controller.startNav();
    await sched.runTicks(0);
    const handler = vi.fn();
    controller.onDelta(handler);
    controller.dispose();
    expect(controller.navRunning).toBe(false);
    expect(controller.perfHotspotsRunning).toBe(false);
    fake.setNext({ ok: true, state: 2 });
    await sched.runTicks(3);
    expect(handler).not.toHaveBeenCalled();
  });

  it('startNav after dispose is a no-op (controller is dead)', async () => {
    const sched = makeScheduler();
    const fake = makeFakeCdp();
    const controller = new BridgeController({
      getCdp: () => fake.cdp,
      scheduler: sched,
    });
    controller.dispose();
    controller.startNav();
    await sched.runTicks(0);
    expect(fake.callCount()).toBe(0);
    expect(controller.navRunning).toBe(false);
  });

  it('two pollers run independently and tag their deltas correctly', async () => {
    const sched = makeScheduler();
    const fake = makeFakeCdp();
    const controller = new BridgeController({
      getCdp: () => fake.cdp,
      scheduler: sched,
    });
    const deltas: BridgeDelta[] = [];
    controller.onDelta((d) => deltas.push(d));
    // First nav tick, then perf tick.
    fake.setNext({ ok: true, state: { screen: 'A' } });
    controller.startNav();
    await sched.runTicks(0);
    fake.setNext({ ok: true, hotspots: [] });
    controller.startPerfHotspots();
    await sched.runTicks(0);
    expect(deltas).toEqual([
      { kind: 'nav', state: { screen: 'A' } },
      { kind: 'perf_hotspots', hotspots: [] },
    ]);
    controller.dispose();
  });
});
