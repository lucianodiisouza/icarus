import { runDoctor } from '@icarus/core';
import {
  appEchoInputSchema,
  CHANNELS,
  doctorCheckInputSchema,
  type AppEchoOutput,
} from '../../shared/ipc/contracts.js';
import type { IpcRouter } from './router.js';

/**
 * Register the walking-skeleton IPC handlers on a router. Kept separate from the Electron
 * binding so it can be tested against a plain `IpcRouter` (no shell). The one real
 * capability is `doctor.check` → `runDoctor()` from @icarus/core (US-08).
 */
export function registerHandlers(router: IpcRouter): void {
  router.register(CHANNELS.DOCTOR_CHECK, doctorCheckInputSchema, async () => runDoctor());

  router.register(
    CHANNELS.APP_ECHO,
    appEchoInputSchema,
    async ({ message }): Promise<AppEchoOutput> => ({
      echoed: message,
      at: new Date().toISOString(),
    }),
  );
}
