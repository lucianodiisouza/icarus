import { UnifiedLogController } from '../unified-log/unified-log-controller.js';
import type { UnifiedLogEntry } from '../unified-log/unified-log.js';
import { defineFeatureModule, type FeatureModule } from './feature-module.js';

/**
 * FeatureModule wrapper for UnifiedLogController (E-10). Same shape as the
 * metro wrapper: the controller owns its lifecycle, the module exposes the
 * unified-log event stream via `on('log', ...)`.
 */
export type UnifiedLogModuleEvents = {
  log: UnifiedLogEntry;
};

export type UnifiedLogModule = FeatureModule<UnifiedLogModuleEvents>;

export function createUnifiedLogModule(
  controller: UnifiedLogController = new UnifiedLogController(),
): UnifiedLogModule {
  let unsubscriber: (() => void) | null = null;

  return defineFeatureModule<UnifiedLogModuleEvents>({
    id: 'unified-log',
    displayName: 'Unified log pipeline',
    events: ['log'],
    init: () => {
      // Idempotent: clear any prior subscription before re-init.
      unsubscriber?.();
      unsubscriber = null;
    },
    dispose: () => {
      unsubscriber?.();
      unsubscriber = null;
      // Forward dispose to the controller so the fan-in subscriptions are released.
      controller.dispose();
    },
    on: (_event, handler) => {
      // The UnifiedLogController has a single event — we expose it as 'log' to
      // match the E-10 IPC contract.
      const off = controller.onEntry(handler as (entry: UnifiedLogEntry) => void);
      unsubscriber = off;
      return () => {
        off();
        if (unsubscriber === off) unsubscriber = null;
      };
    },
  });
}
