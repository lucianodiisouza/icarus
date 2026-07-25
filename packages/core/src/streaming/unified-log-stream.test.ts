import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedLogStream, type UnifiedLogDelta } from './unified-log-stream.js';
import type { UnifiedLogEntry } from '../unified-log/unified-log.js';

/** A minimal source that lets the test emit entries (the controller shape). */
function makeSource() {
  const handlers = new Set<(e: UnifiedLogEntry) => void>();
  return {
    source: {
      onEntry(h: (e: UnifiedLogEntry) => void) {
        handlers.add(h);
        return () => handlers.delete(h);
      },
    },
    emit(text: string) {
      const entry: UnifiedLogEntry = { source: 'metro', level: 'log', text, timestampMs: 0 };
      for (const h of [...handlers]) h(entry);
    },
    handlerCount: () => handlers.size,
  };
}

const opts = { snapshotCapacity: 3, windowMs: 50, maxBatch: 100 };

describe('UnifiedLogStream', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('snapshot returns the recent bounded history (oldest→newest)', () => {
    const { source, emit } = makeSource();
    const stream = new UnifiedLogStream(source, opts);
    emit('a');
    emit('b');
    emit('c');
    emit('d'); // over capacity 3 → 'a' evicted
    expect(stream.snapshot().map((e) => e.text)).toEqual(['b', 'c', 'd']);
  });

  it('delivers new entries to a subscriber as batched append-deltas', () => {
    const { source, emit } = makeSource();
    const stream = new UnifiedLogStream(source, opts);
    const deltas: UnifiedLogDelta[] = [];
    stream.subscribe((d) => deltas.push(d));

    emit('x');
    emit('y');
    expect(deltas).toEqual([]); // still within the window
    vi.advanceTimersByTime(50);
    expect(deltas.map((d) => d.appended.map((e) => e.text))).toEqual([['x', 'y']]);
  });

  it('fans out to multiple subscribers independently', () => {
    const { source, emit } = makeSource();
    const stream = new UnifiedLogStream(source, opts);
    const a: string[] = [];
    const b: string[] = [];
    stream.subscribe((d) => a.push(...d.appended.map((e) => e.text)));
    stream.subscribe((d) => b.push(...d.appended.map((e) => e.text)));
    emit('m');
    vi.advanceTimersByTime(50);
    expect(a).toEqual(['m']);
    expect(b).toEqual(['m']);
    expect(stream.subscriberCount).toBe(2);
  });

  it('unsubscribe flushes the remainder then stops delivery', () => {
    const { source, emit } = makeSource();
    const stream = new UnifiedLogStream(source, opts);
    const deltas: UnifiedLogDelta[] = [];
    const off = stream.subscribe((d) => deltas.push(d));
    emit('pending');
    off(); // flushes 'pending' before detaching
    emit('after');
    vi.advanceTimersByTime(50);
    expect(deltas.map((d) => d.appended.map((e) => e.text))).toEqual([['pending']]);
    expect(stream.subscriberCount).toBe(0);
  });

  it('dispose detaches from the source', () => {
    const { source, emit, handlerCount } = makeSource();
    const stream = new UnifiedLogStream(source, opts);
    expect(handlerCount()).toBe(1);
    stream.dispose();
    expect(handlerCount()).toBe(0);
    // Snapshot still readable but no new entries are recorded after dispose.
    emit('ignored');
    expect(stream.snapshot()).toEqual([]);
  });
});
