import { describe, expect, it } from 'vitest';
import { aggregateNetworkEvents, durationMs, ttfbMs } from './aggregate.js';
import type { CdpNetworkEvent } from '../cdp/network.js';

/**
 * M3 network inspector (E-16) tests for the pure aggregator. The hard rule here is the
 * **E-16 canary**: events with the same `requestId` MUST end up in a single
 * `NetworkRecord`. If this ever breaks, the inspector is a lie.
 */

function req(over: Partial<CdpNetworkEvent> = {}): CdpNetworkEvent {
  return {
    kind: 'request',
    requestId: 'r1',
    timestampMs: 100,
    url: 'https://api.example.com/login',
    method: 'POST',
    ...over,
  };
}

function resp(over: Partial<CdpNetworkEvent> = {}): CdpNetworkEvent {
  return {
    kind: 'response',
    requestId: 'r1',
    timestampMs: 250,
    url: 'https://api.example.com/login',
    method: 'POST',
    status: 200,
    statusText: 'OK',
    contentType: 'application/json',
    ...over,
  };
}

function fail(over: Partial<CdpNetworkEvent> = {}): CdpNetworkEvent {
  return {
    kind: 'failed',
    requestId: 'r1',
    timestampMs: 180,
    errorText: 'net::ERR_CANCELED',
    ...over,
  };
}

function fin(over: Partial<CdpNetworkEvent> = {}): CdpNetworkEvent {
  return {
    kind: 'finished',
    requestId: 'r1',
    timestampMs: 260,
    encodedDataLength: 1024,
    ...over,
  };
}

describe('aggregateNetworkEvents — correlation (E-16 canary)', () => {
  it('groups request + response for the same requestId into one record', () => {
    const out = aggregateNetworkEvents([
      req({ requestId: 'r1', url: 'https://a', method: 'GET', timestampMs: 100 }),
      resp({ requestId: 'r1', url: 'https://a', method: 'GET', status: 200, timestampMs: 250 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.requestId).toBe('r1');
    expect(out[0]?.method).toBe('GET');
    expect(out[0]?.status).toBe(200);
    expect(out[0]?.requestTimestampMs).toBe(100);
    expect(out[0]?.responseTimestampMs).toBe(250);
    expect(out[0]?.endTimestampMs).toBe(250);
    expect(out[0]?.ended).toBe(true);
  });

  it('preserves request-arrival order across multiple calls', () => {
    const out = aggregateNetworkEvents([
      req({ requestId: 'a', url: 'https://a', timestampMs: 100 }),
      req({ requestId: 'b', url: 'https://b', timestampMs: 200 }),
      req({ requestId: 'c', url: 'https://c', timestampMs: 300 }),
    ]);
    expect(out.map((r) => r.requestId)).toEqual(['a', 'b', 'c']);
  });

  it('drops events with no requestId instead of crashing', () => {
    const out = aggregateNetworkEvents([
      { kind: 'request', requestId: '', timestampMs: 1, url: 'https://x', method: 'GET' },
      req({ requestId: 'r1', url: 'https://r1' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.requestId).toBe('r1');
  });

  it('handles response before request (theoretical) by still producing a record', () => {
    const out = aggregateNetworkEvents([resp({ requestId: 'r1', status: 500, timestampMs: 250 })]);
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe(500);
    expect(out[0]?.ended).toBe(true);
  });

  it('a failed event ends the call and tags the failure text', () => {
    const out = aggregateNetworkEvents([
      req({ requestId: 'r1', url: 'https://a', timestampMs: 100 }),
      fail({ requestId: 'r1', errorText: 'net::ERR_NAME_NOT_RESOLVED', timestampMs: 180 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.failure).toBe('net::ERR_NAME_NOT_RESOLVED');
    expect(out[0]?.ended).toBe(true);
    expect(out[0]?.endTimestampMs).toBe(180);
  });

  it('a finished event updates the body size + end timestamp (last-wins on end)', () => {
    const out = aggregateNetworkEvents([
      req({ requestId: 'r1', url: 'https://a', timestampMs: 100 }),
      resp({ requestId: 'r1', status: 200, timestampMs: 250 }),
      fin({ requestId: 'r1', encodedDataLength: 2048, timestampMs: 260 }),
    ]);
    expect(out[0]?.encodedDataLength).toBe(2048);
    expect(out[0]?.endTimestampMs).toBe(260);
  });

  it('does NOT override a later end with an earlier one (defensive)', () => {
    const out = aggregateNetworkEvents([
      req({ requestId: 'r1', url: 'https://a', timestampMs: 100 }),
      resp({ requestId: 'r1', status: 200, timestampMs: 300 }),
      fin({ requestId: 'r1', encodedDataLength: 100, timestampMs: 250 }),
    ]);
    expect(out[0]?.endTimestampMs).toBe(300);
  });
});

describe('aggregateNetworkEvents — headers', () => {
  it('preserves request headers on the request event', () => {
    const out = aggregateNetworkEvents([
      req({
        requestId: 'r1',
        url: 'https://a',
        method: 'POST',
        requestHeaders: { 'content-type': 'application/json', 'x-custom': 'one' },
        timestampMs: 100,
      }),
    ]);
    expect(out[0]?.requestHeaders).toEqual({
      'content-type': 'application/json',
      'x-custom': 'one',
    });
  });

  it('preserves response headers on the response event', () => {
    const out = aggregateNetworkEvents([
      req({ requestId: 'r1', url: 'https://a', timestampMs: 100 }),
      resp({
        requestId: 'r1',
        status: 200,
        timestampMs: 200,
        responseHeaders: { server: 'nginx', 'set-cookie': 'sid=abc; Path=/' },
      }),
    ]);
    expect(out[0]?.responseHeaders).toEqual({
      server: 'nginx',
      'set-cookie': 'sid=abc; Path=/',
    });
  });
});

describe('aggregateNetworkEvents — method normalization', () => {
  it('upper-cases the method', () => {
    const out = aggregateNetworkEvents([req({ method: 'post', url: 'https://a' })]);
    expect(out[0]?.method).toBe('POST');
  });

  it('defaults to GET when method is missing', () => {
    // We have to drop the `method` key entirely (not set it to undefined) under
    // `exactOptionalPropertyTypes`; the test helper `req()` doesn't accept a deletion,
    // so we hand-build the event.
    const ev: CdpNetworkEvent = {
      kind: 'request',
      requestId: 'r1',
      timestampMs: 1,
      url: 'https://a',
    };
    const out = aggregateNetworkEvents([ev]);
    expect(out[0]?.method).toBe('GET');
  });
});

describe('durationMs / ttfbMs', () => {
  it('returns the wall-clock duration when the call is ended', () => {
    const out = aggregateNetworkEvents([
      req({ requestId: 'r1', url: 'https://a', timestampMs: 1000 }),
      resp({ requestId: 'r1', status: 200, timestampMs: 1250 }),
    ]);
    expect(durationMs(out[0]!)).toBe(250);
  });

  it('returns null for duration when the call is not yet ended', () => {
    const out = aggregateNetworkEvents([
      req({ requestId: 'r1', url: 'https://a', timestampMs: 1000 }),
    ]);
    expect(durationMs(out[0]!)).toBeNull();
  });

  it('returns the TTFB (response arrival - request start) when a response arrived', () => {
    const out = aggregateNetworkEvents([
      req({ requestId: 'r1', url: 'https://a', timestampMs: 1000 }),
      resp({ requestId: 'r1', status: 200, timestampMs: 1080 }),
    ]);
    expect(ttfbMs(out[0]!)).toBe(80);
  });

  it('returns null for TTFB when there is no response', () => {
    const out = aggregateNetworkEvents([
      req({ requestId: 'r1', url: 'https://a', timestampMs: 1000 }),
      fail({ requestId: 'r1', errorText: 'oops', timestampMs: 1080 }),
    ]);
    expect(ttfbMs(out[0]!)).toBeNull();
  });

  it('clamps negative durations to 0 (defensive against clock skew)', () => {
    const out = aggregateNetworkEvents([
      req({ requestId: 'r1', url: 'https://a', timestampMs: 1000 }),
      resp({ requestId: 'r1', status: 200, timestampMs: 999 }),
    ]);
    expect(durationMs(out[0]!)).toBe(0);
  });
});
