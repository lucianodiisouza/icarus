import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ring-buffer.js';

describe('RingBuffer', () => {
  it('retains items up to capacity in order', () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    r.push(2);
    expect(r.snapshot()).toEqual([1, 2]);
    expect(r.size).toBe(2);
  });

  it('evicts the oldest once over capacity (keeps the most recent)', () => {
    const r = new RingBuffer<number>(3);
    for (const n of [1, 2, 3, 4, 5]) r.push(n);
    expect(r.snapshot()).toEqual([3, 4, 5]);
    expect(r.size).toBe(3);
  });

  it('snapshot is a copy — mutating it does not affect the buffer', () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    const snap = r.snapshot();
    snap.push(999);
    expect(r.snapshot()).toEqual([1]);
  });

  it('clear empties the buffer', () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    r.clear();
    expect(r.snapshot()).toEqual([]);
    expect(r.size).toBe(0);
  });

  it('rejects a capacity below 1', () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
  });
});
