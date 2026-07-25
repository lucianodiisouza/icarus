import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { CdpMultiplexer, httpOriginFromWsUrl } from '@icarus/core';

/**
 * The `ws`-backed multiplexing proxy (E-14). Opens ONE upstream connection to Hermes and
 * exposes a local WebSocket server that multiple debuggers — Icarus's own CdpClient AND the
 * user's RN DevTools — connect to. Routing (id-rewriting, event broadcast) is done by the
 * Electron-free `CdpMultiplexer` in @icarus/core; this file is only the socket wiring.
 *
 * The Origin header is ADAPTIVE (a live finding): modern RN (>=0.76) REQUIRES an
 * `Origin: http://localhost` (401 without it), but older Metro/Expo Go REJECTS it
 * (closes with 1006). So we connect upstream WITHOUT Origin first and only retry WITH it if
 * the server rejects the upgrade with 401/403.
 */
export interface CdpProxyOptions {
  readonly upstreamUrl: string;
  readonly port?: number;
  readonly origin?: string;
}

export interface CdpProxy {
  readonly port: number;
  readonly downstreamUrl: string;
  /** Whether the upstream needed the Origin header (diagnostic). */
  readonly usedOrigin: boolean;
  clientCount(): number;
  close(): Promise<void>;
}

interface UpstreamResult {
  readonly socket: WebSocket;
  readonly usedOrigin: boolean;
}

/** Connect the upstream, adapting the Origin header to what the server accepts. */
function connectUpstream(url: string, origin: string): Promise<UpstreamResult> {
  return new Promise((resolve, reject) => {
    const attempt = (withOrigin: boolean): void => {
      const socket = new WebSocket(url, withOrigin ? { headers: { Origin: origin } } : {});
      let settled = false;

      socket.once('open', () => {
        settled = true;
        resolve({ socket, usedOrigin: withOrigin });
      });
      socket.once('unexpected-response', (_req: unknown, res: IncomingMessage) => {
        settled = true;
        socket.terminate();
        if (!withOrigin && (res.statusCode === 401 || res.statusCode === 403)) {
          attempt(true); // server wants an Origin — retry with it (modern RN)
        } else {
          reject(new Error(`upstream upgrade failed: HTTP ${res.statusCode ?? '?'}`));
        }
      });
      socket.once('error', (err: Error) => {
        if (!settled) reject(err);
      });
    };
    attempt(false); // try WITHOUT Origin first (older Metro rejects an Origin)
  });
}

export async function startCdpProxy(options: CdpProxyOptions): Promise<CdpProxy> {
  const origin = options.origin ?? httpOriginFromWsUrl(options.upstreamUrl);
  const { socket: upstream, usedOrigin } = await connectUpstream(options.upstreamUrl, origin);

  return new Promise((resolve, reject) => {
    const mux = new CdpMultiplexer((frame) => upstream.send(frame));
    upstream.on('message', (data) => mux.handleUpstream(data.toString()));

    const server = new WebSocketServer({ port: options.port ?? 0 });

    server.on('connection', (socket) => {
      const clientId = mux.addClient((frame) => socket.send(frame));
      socket.on('message', (data) => mux.handleDownstream(clientId, data.toString()));
      socket.on('close', () => mux.removeClient(clientId));
    });

    // If upstream drops, tear the whole proxy down (reconnect is a later slice).
    upstream.once('close', () => server.close());

    server.once('listening', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        port,
        downstreamUrl: `ws://localhost:${port}`,
        usedOrigin,
        clientCount: () => mux.clientCount(),
        close: () =>
          new Promise<void>((res) => {
            upstream.close();
            server.close(() => res());
          }),
      });
    });
    server.once('error', (err: Error) => reject(err));
  });
}
