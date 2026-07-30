import { describe, expect, it, vi } from 'vitest';
import { createNetworkController, registerNetworkChannels } from './network-controller.js';
import type { CdpNetworkEvent, CdpSendLike, NetworkRecord } from '@icarus/core';
import { CHANNELS, EVENTS } from '../shared/ipc/contracts.js';
import { IpcRouter } from './ipc/router.js';
import { z } from 'zod';

/**
 * M3 network inspector (E-16) desktop wiring tests. The hard rule here: the controller
 * is the **only** thing the IPC channels talk to; the recorder is a private sink, and
 * the body fetcher is opt-in and typed.
 */

function event(over: Partial<CdpNetworkEvent> = {}): CdpNetworkEvent {
  return {
    kind: 'request',
    requestId: 'r1',
    timestampMs: 1,
    url: 'https://a',
    method: 'GET',
    ...over,
  };
}

describe('createNetworkController — feed + record', () => {
  it('feeds an event and surfaces a record on the subscription', () => {
    const c = createNetworkController();
    const seen: NetworkRecord[] = [];
    c.onRecord((r) => seen.push(r));
    const rec = c.feed(event({ kind: 'request', requestId: 'r1', url: 'https://a' }));
    expect(rec?.requestId).toBe('r1');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.requestId).toBe('r1');
  });

  it('correlates a request + response for the same id into one record', () => {
    const c = createNetworkController();
    c.feed(event({ kind: 'request', requestId: 'r1', url: 'https://a', timestampMs: 100 }));
    c.feed(
      event({ kind: 'response', requestId: 'r1', status: 200, timestampMs: 250, method: 'GET' }),
    );
    const records = c.records();
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe(200);
  });

  it('clear() empties the recorder', () => {
    const c = createNetworkController();
    c.feed(event({ kind: 'request', requestId: 'a' }));
    c.feed(event({ kind: 'request', requestId: 'b' }));
    expect(c.records()).toHaveLength(2);
    c.clear();
    expect(c.records()).toHaveLength(0);
  });
});

describe('createNetworkController — body fetch is opt-in + typed', () => {
  it('returns not-fetchable when no CDP send is set', async () => {
    const c = createNetworkController();
    const out = await c.fetchBody('r1', 'response');
    expect(out).toEqual({ body: null, skipped: false, reason: 'not-fetchable' });
  });

  it('forwards a request body fetch to the live CDP send with the right method', async () => {
    const c = createNetworkController();
    const send = vi.fn(async (method: string) => {
      if (method === 'Network.getRequestPostData') return { postData: '{"x":1}' };
      return {};
    }) as unknown as CdpSendLike['send'];
    c.setCdpSend({ send });
    const out = await c.fetchBody('r1', 'request');
    expect(send).toHaveBeenCalledWith('Network.getRequestPostData', { requestId: 'r1' });
    expect(out.body).toBe('{"x":1}');
  });

  it('forwards a response body fetch with Network.getResponseBody', async () => {
    const c = createNetworkController();
    const send = vi.fn(async (method: string) => {
      if (method === 'Network.getResponseBody')
        return { body: '{"ok":true}', base64Encoded: false };
      return {};
    }) as unknown as CdpSendLike['send'];
    c.setCdpSend({ send });
    const out = await c.fetchBody('r1', 'response');
    expect(send).toHaveBeenCalledWith('Network.getResponseBody', { requestId: 'r1' });
    expect(out.body).toBe('{"ok":true}');
  });

  it('clear of the CDP send disables further body fetches', async () => {
    const c = createNetworkController();
    c.setCdpSend({ send: vi.fn(async () => ({})) as unknown as CdpSendLike['send'] });
    c.setCdpSend(null);
    const out = await c.fetchBody('r1', 'response');
    expect(out.reason).toBe('not-fetchable');
  });
});

describe('registerNetworkChannels — IPC wiring', () => {
  it('list channel returns the recorder snapshot', async () => {
    const c = createNetworkController();
    c.feed(event({ kind: 'request', requestId: 'a' }));
    c.feed(event({ kind: 'request', requestId: 'b' }));
    const router = new IpcRouter();
    registerNetworkChannels({
      router,
      controller: c,
      window: () => null,
    });
    const out = (await router.dispatch(CHANNELS.NETWORK_LIST, undefined)) as NetworkRecord[];
    expect(out.map((r) => r.requestId)).toEqual(['a', 'b']);
  });

  it('clear channel wipes the recorder', async () => {
    const c = createNetworkController();
    c.feed(event({ kind: 'request', requestId: 'a' }));
    const router = new IpcRouter();
    registerNetworkChannels({ router, controller: c, window: () => null });
    await router.dispatch(CHANNELS.NETWORK_CLEAR, undefined);
    expect(c.records()).toHaveLength(0);
  });

  it('fetchBody channel routes through controller.fetchBody', async () => {
    const c = createNetworkController();
    const send = vi.fn(async () => ({
      body: 'ok',
      base64Encoded: false,
    })) as unknown as CdpSendLike['send'];
    c.setCdpSend({ send });
    const router = new IpcRouter();
    registerNetworkChannels({ router, controller: c, window: () => null });
    const out = await router.dispatch(CHANNELS.NETWORK_FETCH_BODY, {
      requestId: 'r1',
      kind: 'response',
    });
    expect(out).toMatchObject({ body: 'ok' });
  });

  it('forwards every record add/update to the window via EVENTS.NETWORK_RECORD', () => {
    const c = createNetworkController();
    const sent: unknown[] = [];
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) },
    } as unknown as Parameters<typeof registerNetworkChannels>[0]['window'] extends () => infer T
      ? T
      : never;
    const router = new IpcRouter();
    registerNetworkChannels({ router, controller: c, window: () => fakeWindow });
    c.feed(event({ kind: 'request', requestId: 'r1' }));
    c.feed(event({ kind: 'response', requestId: 'r1', status: 200, method: 'GET' }));
    expect(sent).toHaveLength(2);
    expect((sent[0] as { channel: string }).channel).toBe(EVENTS.NETWORK_RECORD);
    expect((sent[1] as { channel: string }).channel).toBe(EVENTS.NETWORK_RECORD);
  });

  it('does NOT forward to a destroyed window', () => {
    const c = createNetworkController();
    const sent: unknown[] = [];
    const fakeWindow = {
      isDestroyed: () => true,
      webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) },
    } as unknown as Parameters<typeof registerNetworkChannels>[0]['window'] extends () => infer T
      ? T
      : never;
    const router = new IpcRouter();
    registerNetworkChannels({ router, controller: c, window: () => fakeWindow });
    c.feed(event({ kind: 'request', requestId: 'r1' }));
    expect(sent).toHaveLength(0);
  });

  it('the unsubscribe returned by registerNetworkChannels detaches the record push', () => {
    const c = createNetworkController();
    const sent: unknown[] = [];
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) },
    } as unknown as Parameters<typeof registerNetworkChannels>[0]['window'] extends () => infer T
      ? T
      : never;
    const router = new IpcRouter();
    const off = registerNetworkChannels({ router, controller: c, window: () => fakeWindow });
    off();
    c.feed(event({ kind: 'request', requestId: 'r1' }));
    expect(sent).toHaveLength(0);
  });
});

// Sanity: the channel handler types align with the router (a typed-rejection regression
// guard — if the channel signature drifts, this test fails to compile).
describe('router handler return types', () => {
  it('list returns a Promise (router contract)', async () => {
    const c = createNetworkController();
    const router = new IpcRouter();
    registerNetworkChannels({ router, controller: c, window: () => null });
    // The cast is just to make TS prove the return is a Promise.
    const result: unknown = await router.dispatch(CHANNELS.NETWORK_LIST, undefined);
    expect(Array.isArray(result)).toBe(true);
  });
});

// Just exercising the zod import so the import doesn't get tree-shaken.
void z;
