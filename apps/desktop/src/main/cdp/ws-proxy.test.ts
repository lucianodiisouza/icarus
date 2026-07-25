import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { startCdpProxy, type CdpProxy } from './ws-proxy.js';

/**
 * Integration test over REAL loopback sockets (no RN app needed): a fake upstream CDP
 * server that echoes commands and can push events, the real multiplexing proxy in front of
 * it, and two downstream clients whose colliding ids must stay separate. Also covers the
 * adaptive Origin behaviour (no Origin first; retry with Origin only on 401).
 */
function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}
function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

interface FakeUpstream {
  readonly url: string;
  readonly server: WebSocketServer;
  send(obj: unknown): void;
  lastOrigin(): string | undefined;
}

async function startFakeUpstream(opts: { requireOrigin: boolean }): Promise<FakeUpstream> {
  let origin: string | undefined;
  let conn: WebSocket | undefined;
  const server = new WebSocketServer({
    port: 0,
    verifyClient: (info: { req: IncomingMessage }) => {
      const o = info.req.headers.origin;
      if (opts.requireOrigin && !o) return false; // simulate modern RN's 401-without-Origin
      origin = o;
      return true;
    },
  });
  server.on('connection', (ws) => {
    conn = ws;
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { id?: number; method?: string };
      if (typeof msg.id === 'number') {
        ws.send(JSON.stringify({ id: msg.id, result: { echoedMethod: msg.method } }));
      }
    });
  });
  await new Promise<void>((res) => server.once('listening', () => res()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `ws://localhost:${port}`,
    server,
    send: (obj) => conn?.send(JSON.stringify(obj)),
    lastOrigin: () => origin,
  };
}

describe('startCdpProxy (integration)', () => {
  let proxy: CdpProxy | undefined;
  let upstream: FakeUpstream | undefined;
  const clients: WebSocket[] = [];

  afterEach(async () => {
    for (const c of clients) c.close();
    clients.length = 0;
    await proxy?.close();
    proxy = undefined;
    await new Promise<void>((res) => (upstream ? upstream.server.close(() => res()) : res()));
    upstream = undefined;
  });

  it(
    'connects WITHOUT Origin to an older-style upstream and multiplexes colliding ids',
    { timeout: 15000 },
    async () => {
      upstream = await startFakeUpstream({ requireOrigin: false });
      proxy = await startCdpProxy({ upstreamUrl: upstream.url });

      expect(proxy.usedOrigin).toBe(false);
      expect(upstream.lastOrigin()).toBeUndefined();

      const a = new WebSocket(proxy.downstreamUrl);
      const b = new WebSocket(proxy.downstreamUrl);
      clients.push(a, b);
      await Promise.all([opened(a), opened(b)]);
      await new Promise((r) => setTimeout(r, 50));
      expect(proxy.clientCount()).toBe(2);

      const aReply = nextMessage(a);
      const bReply = nextMessage(b);
      a.send(JSON.stringify({ id: 1, method: 'A.ping' }));
      b.send(JSON.stringify({ id: 1, method: 'B.ping' }));
      expect(await aReply).toEqual({ id: 1, result: { echoedMethod: 'A.ping' } });
      expect(await bReply).toEqual({ id: 1, result: { echoedMethod: 'B.ping' } });

      const aEvent = nextMessage(a);
      const bEvent = nextMessage(b);
      upstream.send({ method: 'Runtime.consoleAPICalled', params: { type: 'log' } });
      expect(await aEvent).toMatchObject({ method: 'Runtime.consoleAPICalled' });
      expect(await bEvent).toMatchObject({ method: 'Runtime.consoleAPICalled' });

      b.close();
      await new Promise((r) => setTimeout(r, 100));
      expect(proxy.clientCount()).toBe(1);
    },
  );

  it(
    'retries WITH Origin when the upstream rejects the origin-less upgrade (401)',
    { timeout: 15000 },
    async () => {
      upstream = await startFakeUpstream({ requireOrigin: true });
      proxy = await startCdpProxy({ upstreamUrl: upstream.url });

      expect(proxy.usedOrigin).toBe(true);
      expect(upstream.lastOrigin()).toBe(`http://localhost:${new URL(upstream.url).port}`);
    },
  );

  it('rejects when the upstream is unreachable', { timeout: 15000 }, async () => {
    await expect(startCdpProxy({ upstreamUrl: 'ws://localhost:1/nope' })).rejects.toBeDefined();
  });
});
