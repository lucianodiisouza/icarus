import type { BrowserWindow } from 'electron';
import { takePerfSnapshot, type CdpSendLike, type PerfSnapshot } from '@icarus/core';
import { CHANNELS } from '../shared/ipc/contracts.js';
import { perfSnapshotInputSchema } from '../shared/ipc/contracts.js';
import type { IpcRouter } from './ipc/router.js';

/**
 * The desktop wiring of the M3 performance inspector (E-19, minimal viable).
 * Same shape as the other inspectors: a small main-process orchestrator
 * that owns the snapshot. The snapshot composes three CDP calls (heap,
 * metrics, render hot-spots) — all read-only, all behind the user's click.
 *
 * `recentErrorCount` is an optional extension point: the desktop wiring
 * is free to fill it (e.g. by counting the assistant's bounded context of
 * recent errors). For v1 the renderer treats it as 0 / "n/a" if absent.
 */

export interface PerfController {
  /** The CDP `send` seam (set when the session is connected). */
  readonly setCdpSend: (send: CdpSendLike | null) => void;
  /** Take a snapshot of the running app's perf metrics. */
  readonly snapshot: () => Promise<PerfSnapshot>;
}

export function createPerfController(
  deps: {
    /** Optional: a getter that returns the recent error count. */
    readonly recentErrorCount?: () => number;
  } = {},
): PerfController {
  let cdpSend: CdpSendLike | null = null;
  return {
    setCdpSend: (send) => {
      cdpSend = send;
    },
    snapshot: async () => {
      const snap = await takePerfSnapshot(cdpSend);
      if (deps.recentErrorCount) {
        return { ...snap, recentErrorCount: deps.recentErrorCount() };
      }
      return snap;
    },
  };
}

export interface RegisterPerfChannelsDeps {
  readonly router: IpcRouter;
  readonly controller: PerfController;
  /** Currently unused — kept for parity with the other inspectors. */
  readonly window?: () => BrowserWindow | null;
}

export function registerPerfChannels(deps: RegisterPerfChannelsDeps): () => void {
  const { router, controller } = deps;
  router.register(
    CHANNELS.PERF_SNAPSHOT,
    perfSnapshotInputSchema,
    async (): Promise<PerfSnapshot> => controller.snapshot(),
  );
  return () => undefined;
}
