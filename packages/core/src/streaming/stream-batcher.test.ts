import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamBatcher } from './stream-batcher.js';

describe('StreamBatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces items pushed within the window into one flush', () => {
    const batches: number[][] = [];
    const b = new StreamBatcher<number>({
      maxBatch: 100,
      windowMs: 50,
      onFlush: (x) => batches.push(x),
    });
    b.push(1);
    b.push(2);
    b.push(3);
    expect(batches).toEqual([]); // nothing flushed yet — still inside the window
    vi.advanceTimersByTime(50);
    expect(batches).toEqual([[1, 2, 3]]);
  });

  it('flushes immediately when the count cap is hit (bounded buffer)', () => {
    const batches: number[][] = [];
    const b = new StreamBatcher<number>({
      maxBatch: 3,
      windowMs: 1000,
      onFlush: (x) => batches.push(x),
    });
    b.push(1);
    b.push(2);
    expect(b.pending).toBe(2);
    b.push(3); // hits maxBatch → immediate flush, no waiting for the window
    expect(batches).toEqual([[1, 2, 3]]);
    expect(b.pending).toBe(0);
  });

  it('starts a fresh window for items pushed after a flush', () => {
    const batches: number[][] = [];
    const b = new StreamBatcher<number>({
      maxBatch: 100,
      windowMs: 50,
      onFlush: (x) => batches.push(x),
    });
    b.push(1);
    vi.advanceTimersByTime(50);
    b.push(2);
    b.push(3);
    vi.advanceTimersByTime(50);
    expect(batches).toEqual([[1], [2, 3]]);
  });

  it('never drops items — backpressure trades latency/IPC-count, not data', () => {
    const seen: number[] = [];
    const b = new StreamBatcher<number>({
      maxBatch: 10,
      windowMs: 5,
      onFlush: (x) => seen.push(...x),
    });
    for (let i = 0; i < 95; i += 1) b.push(i);
    b.flush();
    expect(seen).toHaveLength(95);
    expect(seen).toEqual([...Array(95).keys()]);
  });

  it('dispose flushes the remainder then rejects further pushes', () => {
    const batches: number[][] = [];
    const b = new StreamBatcher<number>({
      maxBatch: 100,
      windowMs: 50,
      onFlush: (x) => batches.push(x),
    });
    b.push(1);
    b.dispose();
    expect(batches).toEqual([[1]]); // flushed on dispose — nothing lost
    b.push(2); // ignored after dispose
    vi.advanceTimersByTime(1000);
    expect(batches).toEqual([[1]]);
  });

  it('rejects invalid options', () => {
    expect(() => new StreamBatcher({ maxBatch: 0, windowMs: 1, onFlush: () => {} })).toThrow(
      RangeError,
    );
    expect(() => new StreamBatcher({ maxBatch: 1, windowMs: -1, onFlush: () => {} })).toThrow(
      RangeError,
    );
  });

  /**
   * The TR-6 load test (E-03s DoD). A synthetic high-rate producer must NOT
   * translate into a high-rate consumer: with a time window, the flush count —
   * i.e. the IPC-message / React-render count, the thing that janks the UI — is
   * bounded by elapsed-time / window, NOT by the input rate. And no entry is lost.
   */
  it('bounds flush count under a synthetic high-rate burst (TR-6)', () => {
    let flushes = 0;
    let delivered = 0;
    let maxBatchSeen = 0;
    const windowMs = 50;
    const maxBatch = 500;
    const b = new StreamBatcher<number>({
      maxBatch,
      windowMs,
      onFlush: (batch) => {
        flushes += 1;
        delivered += batch.length;
        maxBatchSeen = Math.max(maxBatchSeen, batch.length);
      },
    });

    // 100k entries over 10 simulated seconds at ~200 entries per 20ms tick.
    const totalTicks = 500; // 500 ticks * 20ms = 10s
    const perTick = 200;
    const total = totalTicks * perTick; // 100_000
    for (let t = 0; t < totalTicks; t += 1) {
      for (let i = 0; i < perTick; i += 1) b.push(t * perTick + i);
      vi.advanceTimersByTime(20);
    }
    b.dispose();

    // No data loss.
    expect(delivered).toBe(total);
    // Batch size stays bounded by maxBatch (memory bound holds).
    expect(maxBatchSeen).toBeLessThanOrEqual(maxBatch);
    // The whole point: flush count is a tiny fraction of the 100k input events.
    // Bounded by ceil(total / maxBatch) from the count cap; nowhere near 100k.
    expect(flushes).toBeLessThanOrEqual(Math.ceil(total / maxBatch) + totalTicks);
    expect(flushes).toBeLessThan(total / 100); // < 1000 flushes for 100k inputs
  });
});
