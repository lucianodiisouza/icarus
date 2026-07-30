import type { BrowserWindow } from 'electron';
import { takeNavSnapshot, type CdpSendLike, type NavSnapshot } from '@icarus/core';
import { CHANNELS } from '../shared/ipc/contracts.js';
import { navSnapshotInputSchema } from '../shared/ipc/contracts.js';
import type { IpcRouter } from './ipc/router.js';

/**
 * The desktop wiring of the M3 navigation inspector (E-20). Same shape as
 * the other inspectors: a small main-process orchestrator that owns the
 * `Runtime.evaluate` round-trip. Pull-only on click; the renderer is the
 * only door.
 *
 * The actual state read is `globalThis.__ICARUS_NAV_STATE__` — the app
 * publishes it via a one-line bridge (see docs/engineering/27). If the
 * bridge is missing, the snapshot returns `no_bridge` and the renderer
 * shows a copy-paste snippet.
 */

export interface NavController {
  /** The CDP `send` seam (set when the session is connected). */
  readonly setCdpSend: (send: CdpSendLike | null) => void;
  /** Take a snapshot of the running app's nav state. */
  readonly snapshot: () => Promise<NavSnapshot>;
}

export function createNavController(): NavController {
  let cdpSend: CdpSendLike | null = null;
  return {
    setCdpSend: (send) => {
      cdpSend = send;
    },
    snapshot: () => takeNavSnapshot(cdpSend),
  };
}

export interface RegisterNavChannelsDeps {
  readonly router: IpcRouter;
  readonly controller: NavController;
  /** Currently unused — kept for parity with the other inspectors. */
  readonly window?: () => BrowserWindow | null;
}

export function registerNavChannels(deps: RegisterNavChannelsDeps): () => void {
  const { router, controller } = deps;
  router.register(CHANNELS.NAV_SNAPSHOT, navSnapshotInputSchema, async (): Promise<NavSnapshot> =>
    controller.snapshot(),
  );
  return () => undefined;
}
