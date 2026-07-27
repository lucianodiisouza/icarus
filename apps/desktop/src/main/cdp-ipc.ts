import type { BrowserWindow } from 'electron';
import {
  CdpClient,
  discoverProxies,
  type CdpNetworkEvent,
  type UnifiedLogController,
} from '@icarus/core';
import {
  CHANNELS,
  EVENTS,
  cdpConnectInputSchema,
  cdpDisconnectInputSchema,
  type CdpCommandOutput,
} from '../shared/ipc/contracts.js';
import type { IpcRouter } from './ipc/router.js';
import { CdpSession } from './cdp/cdp-session.js';
import { startCdpProxy } from './cdp/ws-proxy.js';
import { wsSocketFactory } from './cdp/ws-socket-factory.js';

/**
 * The desktop wiring of the live CDP session (E-14). Extracted from `index.ts` so the entry stays
 * a thin orchestrator (mirrors `assistant-ipc`). Owns the single active session's lifecycle — one
 * per window — plus the connect/disconnect commands. Console + network events fan out to the
 * window's renderer and into the shared unified log (E-10) / assistant context (E-13).
 */

export interface CdpController {
  /** Build the window's CDP session and make it the active one (on window create). */
  readonly attachToWindow: (window: BrowserWindow) => void;
  /** Disconnect and drop the active session (on window close). */
  readonly detach: () => Promise<void>;
  /** Connect the active session; returns the resulting status. */
  readonly connect: () => Promise<CdpCommandOutput>;
  /** Disconnect the active session. */
  readonly disconnect: () => Promise<CdpCommandOutput>;
  /** True while connecting or connected — the auto-attach busy check (TD-16). */
  readonly isBusy: () => boolean;
}

export function createCdpController(deps: {
  readonly unified: UnifiedLogController;
  readonly captureNetworkEvent: (event: CdpNetworkEvent) => void;
}): CdpController {
  let session: CdpSession | undefined;

  const createSession = (window: BrowserWindow): CdpSession => {
    const push = (channel: string, payload: unknown): void => {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    };
    return new CdpSession({
      discover: async () => (await discoverProxies()).flatMap((proxy) => proxy.targets),
      startProxy: (upstreamUrl) => startCdpProxy({ upstreamUrl }),
      createClient: (downstreamUrl) =>
        new CdpClient(downstreamUrl, { socketFactory: wsSocketFactory }),
      onLog: (entry) => {
        push(EVENTS.CDP_LOG, entry);
        deps.unified.pushCdp(entry); // fan in to the unified log stream (E-10)
      },
      onNetwork: (event) => {
        push(EVENTS.CDP_NETWORK, event);
        deps.captureNetworkEvent(event); // retain for the assistant's bounded context (E-13)
      },
      onStatus: (event) => push(EVENTS.CDP_STATUS, event),
    });
  };

  return {
    attachToWindow: (window) => {
      session = createSession(window);
    },
    detach: async () => {
      await session?.disconnect();
      session = undefined;
    },
    connect: async () => {
      await session?.connect();
      return { status: session?.status ?? 'disconnected' };
    },
    disconnect: async () => {
      await session?.disconnect();
      return { status: 'disconnected' };
    },
    isBusy: () => session?.status === 'connecting' || session?.status === 'connected',
  };
}

/**
 * Register the CDP connect/disconnect commands on the router. `onUserDisconnect` lets the caller
 * mark an explicit disconnect so the auto-attach policy (TD-16) doesn't immediately reconnect on
 * the next Metro-ready event — the user re-enables it from the renderer's auto-attach toggle.
 */
export function registerCdpChannels(
  router: IpcRouter,
  controller: CdpController,
  onUserDisconnect: () => void,
): void {
  router.register(CHANNELS.CDP_CONNECT, cdpConnectInputSchema, () => controller.connect());
  router.register(CHANNELS.CDP_DISCONNECT, cdpDisconnectInputSchema, () => {
    onUserDisconnect();
    return controller.disconnect();
  });
}
