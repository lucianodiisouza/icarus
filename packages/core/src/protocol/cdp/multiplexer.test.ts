import { describe, expect, it, vi } from 'vitest';
import { CdpMultiplexer } from './multiplexer.js';

function parseFrames(frames: string[]): Array<Record<string, unknown>> {
  return frames.map((f) => JSON.parse(f) as Record<string, unknown>);
}

describe('CdpMultiplexer', () => {
  it('tracks clients', () => {
    const mux = new CdpMultiplexer(vi.fn());
    const a = mux.addClient(vi.fn());
    const b = mux.addClient(vi.fn());
    expect(mux.clientCount()).toBe(2);
    expect(a).not.toBe(b);
    mux.removeClient(a);
    expect(mux.clientCount()).toBe(1);
  });

  it('rewrites a downstream command to a unique upstream id and routes the response back', () => {
    const upstream: string[] = [];
    const clientFrames: string[] = [];
    const mux = new CdpMultiplexer((f) => upstream.push(f));
    const client = mux.addClient((f) => clientFrames.push(f));

    mux.handleDownstream(client, JSON.stringify({ id: 1, method: 'Runtime.evaluate' }));

    const sentUp = parseFrames(upstream)[0]!;
    expect(sentUp['method']).toBe('Runtime.evaluate');
    expect(typeof sentUp['id']).toBe('number'); // rewritten to an upstream id we control
    expect(mux.pendingCount()).toBe(1);

    mux.handleUpstream(JSON.stringify({ id: sentUp['id'], result: { value: 2 } }));

    expect(parseFrames(clientFrames)[0]).toEqual({ id: 1, result: { value: 2 } });
    expect(mux.pendingCount()).toBe(0);
  });

  it('keeps two clients with colliding original ids separate', () => {
    const upstream: string[] = [];
    const aFrames: string[] = [];
    const bFrames: string[] = [];
    const mux = new CdpMultiplexer((f) => upstream.push(f));
    const a = mux.addClient((f) => aFrames.push(f));
    const b = mux.addClient((f) => bFrames.push(f));

    // Both send id:1
    mux.handleDownstream(a, JSON.stringify({ id: 1, method: 'A' }));
    mux.handleDownstream(b, JSON.stringify({ id: 1, method: 'B' }));
    const ups = parseFrames(upstream);
    const upIdForA = ups[0]!['id'] as number;
    const upIdForB = ups[1]!['id'] as number;
    expect(upIdForA).not.toBe(upIdForB);

    // Responses come back out of order
    mux.handleUpstream(JSON.stringify({ id: upIdForB, result: 'for-b' }));
    mux.handleUpstream(JSON.stringify({ id: upIdForA, result: 'for-a' }));

    expect(parseFrames(aFrames)[0]).toEqual({ id: 1, result: 'for-a' });
    expect(parseFrames(bFrames)[0]).toEqual({ id: 1, result: 'for-b' });
  });

  it('broadcasts upstream events (no id) to every client', () => {
    const aFrames: string[] = [];
    const bFrames: string[] = [];
    const mux = new CdpMultiplexer(vi.fn());
    mux.addClient((f) => aFrames.push(f));
    mux.addClient((f) => bFrames.push(f));

    const event = JSON.stringify({ method: 'Runtime.consoleAPICalled', params: { type: 'log' } });
    mux.handleUpstream(event);

    expect(aFrames).toEqual([event]);
    expect(bFrames).toEqual([event]);
  });

  it('drops a response whose client has disconnected (no throw)', () => {
    const upstream: string[] = [];
    const mux = new CdpMultiplexer((f) => upstream.push(f));
    const client = mux.addClient(vi.fn());
    mux.handleDownstream(client, JSON.stringify({ id: 1, method: 'X' }));
    const upId = parseFrames(upstream)[0]!['id'] as number;

    mux.removeClient(client);
    expect(mux.pendingCount()).toBe(0); // mapping cleaned up on removal

    expect(() => mux.handleUpstream(JSON.stringify({ id: upId, result: 1 }))).not.toThrow();
  });

  it('ignores frames from an unknown client and non-JSON frames', () => {
    const upstream = vi.fn();
    const mux = new CdpMultiplexer(upstream);
    mux.handleDownstream('ghost', JSON.stringify({ id: 1, method: 'X' }));
    expect(upstream).not.toHaveBeenCalled();

    const client = mux.addClient(vi.fn());
    expect(() => mux.handleDownstream(client, 'not json')).not.toThrow();
    expect(() => mux.handleUpstream('not json')).not.toThrow();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('drops an unknown upstream response id', () => {
    const client = vi.fn();
    const mux = new CdpMultiplexer(vi.fn());
    mux.addClient(client);
    mux.handleUpstream(JSON.stringify({ id: 9999, result: 'orphan' }));
    expect(client).not.toHaveBeenCalled();
  });
});
