import { describe, expect, it } from 'vitest';
import { NetworkRecorder } from './recorder.js';
import type { CdpNetworkEvent } from '../cdp/network.js';

/**
 * M3 network inspector (E-16) — live recorder tests. The aggregator tests already prove
 * correlation works on a flat event list; the recorder adds:
 *   - subscription on record add/update
 *   - bounded buffer (oldest drops off)
 *   - snapshot via .records()
 *   - clear()
 */

function ev(over: Partial<CdpNetworkEvent> = {}): CdpNetworkEvent {
  return {
    kind: 'request',
    requestId: 'r1',
    timestampMs: 1,
    url: 'https://a',
    method: 'GET',
    ...over,
  };
}

describe('NetworkRecorder — live correlation', () => {
  it('emits one record per requestId and updates it as more events arrive', () => {
    const r = new NetworkRecorder();
    const seen: string[] = [];
    r.onRecord((rec) => seen.push(`${rec.requestId}:${rec.status ?? '-'}`));

    r.push(ev({ kind: 'request', requestId: 'r1', timestampMs: 100 }));
    r.push(ev({ kind: 'response', requestId: 'r1', timestampMs: 200, status: 200 }));
    r.push(ev({ kind: 'finished', requestId: 'r1', timestampMs: 250, encodedDataLength: 512 }));

    expect(seen).toEqual(['r1:-', 'r1:200', 'r1:200']);
    expect(r.size).toBe(1);
    expect(r.records()[0]?.status).toBe(200);
    expect(r.records()[0]?.encodedDataLength).toBe(512);
  });

  it('keeps insertion order across multiple calls', () => {
    const r = new NetworkRecorder();
    r.push(ev({ kind: 'request', requestId: 'a', timestampMs: 1 }));
    r.push(ev({ kind: 'request', requestId: 'b', timestampMs: 2 }));
    r.push(ev({ kind: 'request', requestId: 'c', timestampMs: 3 }));
    expect(r.records().map((rec) => rec.requestId)).toEqual(['a', 'b', 'c']);
  });

  it('drops events with no requestId (defensive)', () => {
    const r = new NetworkRecorder();
    const ret = r.push({ kind: 'request', requestId: '', timestampMs: 1, url: 'x', method: 'GET' });
    expect(ret).toBeNull();
    expect(r.size).toBe(0);
  });

  it('a duplicate request event for the same id is ignored (CDP can emit one on a redirect)', () => {
    const r = new NetworkRecorder();
    r.push(ev({ kind: 'request', requestId: 'r1', url: 'https://a', timestampMs: 100 }));
    const second = r.push(
      ev({ kind: 'request', requestId: 'r1', url: 'https://a-redirected', timestampMs: 110 }),
    );
    expect(second?.url).toBe('https://a'); // first one wins
    expect(r.size).toBe(1);
  });
});

describe('NetworkRecorder — bounded buffer', () => {
  it('drops the oldest record when the cap is exceeded', () => {
    const r = new NetworkRecorder({ maxRecords: 2 });
    r.push(ev({ kind: 'request', requestId: 'a', timestampMs: 1 }));
    r.push(ev({ kind: 'request', requestId: 'b', timestampMs: 2 }));
    r.push(ev({ kind: 'request', requestId: 'c', timestampMs: 3 }));
    expect(r.size).toBe(2);
    expect(r.records().map((rec) => rec.requestId)).toEqual(['b', 'c']);
  });

  it('keeps insertion order even as the same id is updated (updates do not reorder)', () => {
    const r = new NetworkRecorder({ maxRecords: 2 });
    r.push(ev({ kind: 'request', requestId: 'a', timestampMs: 1 }));
    r.push(ev({ kind: 'request', requestId: 'b', timestampMs: 2 }));
    r.push(ev({ kind: 'response', requestId: 'a', status: 200, timestampMs: 3 }));
    // 'a' is updated in place, not re-inserted. Order stays by first request.
    expect(r.records().map((rec) => rec.requestId)).toEqual(['a', 'b']);
    expect(r.records()[0]?.status).toBe(200);
  });
});

describe('NetworkRecorder — clear + unsubscribe', () => {
  it('clear() empties the buffer and stops the size counting', () => {
    const r = new NetworkRecorder();
    r.push(ev({ kind: 'request', requestId: 'a', timestampMs: 1 }));
    r.push(ev({ kind: 'request', requestId: 'b', timestampMs: 2 }));
    r.clear();
    expect(r.size).toBe(0);
    expect(r.records()).toEqual([]);
  });

  it('the unsubscribe function detaches the handler', () => {
    const r = new NetworkRecorder();
    let count = 0;
    const off = r.onRecord(() => {
      count += 1;
    });
    r.push(ev({ kind: 'request', requestId: 'r1', timestampMs: 1 }));
    off();
    r.push(ev({ kind: 'response', requestId: 'r1', status: 200, timestampMs: 2 }));
    expect(count).toBe(1);
  });
});
