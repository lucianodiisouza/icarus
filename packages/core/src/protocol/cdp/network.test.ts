import { describe, expect, it } from 'vitest';
import { NETWORK_EVENTS, formatNetworkEvent } from './network.js';

const now = () => 1_000_000;

describe('formatNetworkEvent', () => {
  it('parses Network.requestWillBeSent → request kind with url and method', () => {
    const event = formatNetworkEvent(
      NETWORK_EVENTS.REQUEST_WILL_BE_SENT,
      {
        requestId: 'r1',
        timestamp: 100,
        request: { url: 'https://api.example.com/users', method: 'GET' },
      },
      now,
    );
    expect(event).toEqual({
      kind: 'request',
      requestId: 'r1',
      timestampMs: 100,
      url: 'https://api.example.com/users',
      method: 'GET',
    });
  });

  it('parses Network.responseReceived → response kind with status + contentType', () => {
    const event = formatNetworkEvent(
      NETWORK_EVENTS.RESPONSE_RECEIVED,
      {
        requestId: 'r1',
        timestamp: 250,
        response: {
          url: 'https://api.example.com/users',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
          requestMethod: 'GET',
        },
      },
      now,
    );
    expect(event).toEqual({
      kind: 'response',
      requestId: 'r1',
      timestampMs: 250,
      url: 'https://api.example.com/users',
      method: 'GET',
      status: 200,
      statusText: 'OK',
      contentType: 'application/json',
    });
  });

  it('parses Network.loadingFailed → failed kind with errorText', () => {
    const event = formatNetworkEvent(
      NETWORK_EVENTS.LOADING_FAILED,
      {
        requestId: 'r2',
        timestamp: 500,
        errorText: 'net::ERR_CONNECTION_REFUSED',
      },
      now,
    );
    expect(event).toEqual({
      kind: 'failed',
      requestId: 'r2',
      timestampMs: 500,
      errorText: 'net::ERR_CONNECTION_REFUSED',
    });
  });

  it('returns null when the requestId is missing', () => {
    expect(
      formatNetworkEvent(NETWORK_EVENTS.REQUEST_WILL_BE_SENT, { request: {} }, now),
    ).toBeNull();
  });

  it('returns null for non-record params (never throws)', () => {
    expect(formatNetworkEvent(NETWORK_EVENTS.REQUEST_WILL_BE_SENT, null)).toBeNull();
    expect(formatNetworkEvent(NETWORK_EVENTS.REQUEST_WILL_BE_SENT, 42)).toBeNull();
    expect(formatNetworkEvent(NETWORK_EVENTS.REQUEST_WILL_BE_SENT, 'oops')).toBeNull();
  });

  it('returns null for unknown CDP method names', () => {
    expect(formatNetworkEvent('Network.somethingElse', { requestId: 'r1' }, now)).toBeNull();
  });

  it('falls back to now() when the CDP timestamp is missing or non-finite', () => {
    const event = formatNetworkEvent(
      NETWORK_EVENTS.REQUEST_WILL_BE_SENT,
      { requestId: 'r3', request: { url: 'x', method: 'POST' } },
      now,
    );
    expect(event?.timestampMs).toBe(1_000_000);
  });

  it('survives a request shape that is not a record', () => {
    const event = formatNetworkEvent(
      NETWORK_EVENTS.REQUEST_WILL_BE_SENT,
      { requestId: 'r4', timestamp: 0, request: 'not-an-object' },
      now,
    );
    expect(event).toEqual({
      kind: 'request',
      requestId: 'r4',
      timestampMs: 0,
      url: undefined,
      method: undefined,
    });
  });
});
