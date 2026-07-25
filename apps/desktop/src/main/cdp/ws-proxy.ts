import { WebSocket, WebSocketServer } from 'ws';
import { CdpMultiplexer, httpOriginFromWsUrl } from '@icarus/core';

/**
 * The `ws`-backed multiplexing proxy (E-14). Opens ONE upstream connection to Hermes (with
 * the Origin CSRF header the spike found is required) and exposes a local WebSocket server
 * that multiple debuggers — Icarus's own CdpClient AND the user's RN DevTools — connect to.
 * All routing (id-rewriting, event broadcast) is done by the Electron-free `CdpMultiplexer`
 * in @icarus/core; this file is only the socket wiring (Node, runs in the Electron main
 * process). Node has no built-in WebSocket server, hence `ws`.
 */
export interface CdpProxyOptions {
  /** The Hermes debugger ws URL (from discovery + target selection). */
  readonly upstreamUrl: string;
  /** Local port to expose downstream. 0 = an ephemeral free port. */
  readonly port?: number;
  /** Override the Origin sent upstream (default: derived from upstreamUrl). */
  readonly origin?: string;
}

export interface CdpProxy {
  readonly port: number;
  readonly downstreamUrl: string;
  clientCount(): number;
  close(): Promise<void>;
}

export function startCdpProxy(options: CdpProxyOptions): Promise<CdpProxy> {
  const origin = options.origin ?? httpOriginFromWsUrl(options.upstreamUrl);

  return new Promise((resolve, reject) => {
    const upstream = new WebSocket(options.upstreamUrl, { headers: { Origin: origin } });

    upstream.once('error', (err: Error) => reject(err));

    upstream.once('open', () => {
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
  });
}
