import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { startCdpProxy, type CdpProxy } from './ws-proxy.js';

/**
 * Integration test over REAL loopback sockets (no RN app needed): a fake upstream CDP
 * server that echoes commands and can push events, the real multiplexing proxy in front of
 * it, and two downstream clients whose colliding ids must stay separate.
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

describe('startCdpProxy (integration)', () => {
  let proxy: CdpProxy | undefined;
  let upstreamServer: WebSocketServer | undefined;
  const clients: WebSocket[] = [];

  afterEach(async () => {
    for (const c of clients) c.close();
    clients.length = 0;
    await proxy?.close();
    proxy = undefined;
    await new Promise<void>((res) => (upstreamServer ? upstreamServer.close(() => res()) : res()));
    upstreamServer = undefined;
  });

  it(
    'multiplexes two clients through one upstream, routing colliding ids correctly',
    { timeout: 15000 },
    async () => {
      let capturedOrigin: string | undefined;

      // Fake Hermes: echoes {id,method} -> {id,result:{echoedMethod}}; captures Origin.
      upstreamServer = new WebSocketServer({
        port: 0,
        verifyClient: (info: { req: IncomingMessage }) => {
          capturedOrigin = info.req.headers.origin;
          return true;
        },
      });
      let upstreamConn: WebSocket | undefined;
      upstreamServer.on('connection', (ws) => {
        upstreamConn = ws;
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as { id?: number; method?: string };
          if (typeof msg.id === 'number') {
            ws.send(JSON.stringify({ id: msg.id, result: { echoedMethod: msg.method } }));
          }
        });
      });
      await new Promise<void>((res) => upstreamServer!.once('listening', () => res()));
      const upstreamPort = (upstreamServer.address() as AddressInfo).port;

      proxy = await startCdpProxy({ upstreamUrl: `ws://localhost:${upstreamPort}` });
      // The proxy must present a localhost Origin to satisfy RN's CSRF check.
      expect(capturedOrigin).toBe(`http://localhost:${upstreamPort}`);

      const a = new WebSocket(proxy.downstreamUrl);
      const b = new WebSocket(proxy.downstreamUrl);
      clients.push(a, b);
      await Promise.all([opened(a), opened(b)]);
      await new Promise((r) => setTimeout(r, 50));
      expect(proxy.clientCount()).toBe(2);

      // Both send id:1 — responses must route back to the right client with id:1.
      const aReply = nextMessage(a);
      const bReply = nextMessage(b);
      a.send(JSON.stringify({ id: 1, method: 'A.ping' }));
      b.send(JSON.stringify({ id: 1, method: 'B.ping' }));

      expect(await aReply).toEqual({ id: 1, result: { echoedMethod: 'A.ping' } });
      expect(await bReply).toEqual({ id: 1, result: { echoedMethod: 'B.ping' } });

      // An upstream event is broadcast to both clients.
      const aEvent = nextMessage(a);
      const bEvent = nextMessage(b);
      upstreamConn?.send(
        JSON.stringify({ method: 'Runtime.consoleAPICalled', params: { type: 'log' } }),
      );
      expect(await aEvent).toMatchObject({ method: 'Runtime.consoleAPICalled' });
      expect(await bEvent).toMatchObject({ method: 'Runtime.consoleAPICalled' });

      // Disconnecting a client is reflected in the count.
      b.close();
      await new Promise((r) => setTimeout(r, 100));
      expect(proxy.clientCount()).toBe(1);
    },
  );

  it('rejects when the upstream is unreachable', { timeout: 15000 }, async () => {
    await expect(startCdpProxy({ upstreamUrl: 'ws://localhost:1/nope' })).rejects.toBeDefined();
  });
});
