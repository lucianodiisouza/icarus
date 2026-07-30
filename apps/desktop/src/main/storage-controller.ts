import type { BrowserWindow } from 'electron';
import {
  deleteStorageKey,
  getStorageValue,
  listStorage,
  type CdpSendLike,
  type StorageBackendKind,
  type StorageDeleteResult,
  type StorageGetResult,
  type StorageSnapshot,
} from '@icarus/core';
import { CHANNELS } from '../shared/ipc/contracts.js';
import {
  storageListInputSchema,
  storageGetInputSchema,
  storageDeleteInputSchema,
} from '../shared/ipc/contracts.js';
import type { IpcRouter } from './ipc/router.js';

/**
 * The desktop wiring of the M3 storage inspector (E-18). Same shape as the
 * other inspectors: a small main-process orchestrator that owns the
 * `Runtime.evaluate` round-trips for AsyncStorage and MMKV.
 *
 * The renderer drives the inspector by calling the three channels on click
 * (or `Cmd-R`). The JS expressions shipped to the app are tiny IIFEs that
 * try to require the storage module, walk its API, and return a
 * JSON-serializable result. None of them mutate the app except the
 * `storage.delete` channel, which is opt-in and per-key.
 */

export interface StorageController {
  /** Replace the CDP `send` seam (called on session connect/disconnect). */
  readonly setCdpSend: (send: CdpSendLike | null) => void;
  /**
   * The list channel handler — typed result, never throws. Wired by the
   * channel registrar so the renderer can call it.
   */
  readonly list: (backend: StorageBackendKind) => Promise<StorageSnapshot>;
  /**
   * The get channel handler — fetches the full value for one key.
   */
  readonly get: (backend: StorageBackendKind, key: string) => Promise<StorageGetResult>;
  /**
   * The delete channel handler — removes a key from the live store.
   */
  readonly delete: (backend: StorageBackendKind, key: string) => Promise<StorageDeleteResult>;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export function createStorageController(): StorageController {
  let cdpSend: CdpSendLike | null = null;
  return {
    setCdpSend: (send) => {
      cdpSend = send;
    },
    list: (backend) => listStorage(cdpSend, backend, { timeoutMs: DEFAULT_TIMEOUT_MS }),
    get: (backend, key) =>
      getStorageValue(cdpSend, backend, key, { timeoutMs: DEFAULT_TIMEOUT_MS }),
    delete: (backend, key) =>
      deleteStorageKey(cdpSend, backend, key, { timeoutMs: DEFAULT_TIMEOUT_MS }),
  };
}

export interface RegisterStorageChannelsDeps {
  readonly router: IpcRouter;
  readonly controller: StorageController;
  /** Currently unused — kept for parity with the other inspectors. */
  readonly window?: () => BrowserWindow | null;
}

export function registerStorageChannels(deps: RegisterStorageChannelsDeps): () => void {
  const { router, controller } = deps;
  router.register(
    CHANNELS.STORAGE_LIST,
    storageListInputSchema,
    async (input: { backend: StorageBackendKind }): Promise<StorageSnapshot> =>
      controller.list(input.backend),
  );
  router.register(
    CHANNELS.STORAGE_GET,
    storageGetInputSchema,
    async (input: { backend: StorageBackendKind; key: string }): Promise<StorageGetResult> =>
      controller.get(input.backend, input.key),
  );
  router.register(
    CHANNELS.STORAGE_DELETE,
    storageDeleteInputSchema,
    async (input: { backend: StorageBackendKind; key: string }): Promise<StorageDeleteResult> =>
      controller.delete(input.backend, input.key),
  );
  return () => undefined;
}
