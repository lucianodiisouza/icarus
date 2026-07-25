import { WebSocket } from 'ws';
import type { CdpSocket, CdpSocketFactory } from '@icarus/core';

/**
 * Adapts the `ws` client to the core `CdpSocket` interface, sending the Origin CSRF header
 * (ADR-0008). Used to connect Icarus's CdpClient in the Electron main process, which runs
 * Node 20 and has no global WebSocket. The socket abstraction keeps @icarus/core free of a
 * `ws` dependency.
 */
export const wsSocketFactory: CdpSocketFactory = (url, options): CdpSocket => {
  const ws = new WebSocket(url, { headers: { Origin: options.origin } });
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onOpen: (handler) => ws.on('open', handler),
    onMessage: (handler) => ws.on('message', (data) => handler(data.toString())),
    onClose: (handler) => ws.on('close', () => handler()),
    onError: (handler) => ws.on('error', (error: Error) => handler(error)),
  };
};
