import { defineFeatureModule, type FeatureModule } from './feature-module.js';

/**
 * FeatureModule wrapper for DevicesController (E-09). Unlike Metro and Logs, the
 * devices module has no continuous event stream — it's command-driven
 * (list / boot / install / launch). The module's event map is therefore empty;
 * commands stay imperative (the renderer calls them via the existing IcarusApi).
 *
 * Init/dispose are no-ops for the same reason: the controller is constructed
 * eagerly and its lifecycle is method-driven. The conformance test still
 * exercises the dispose-is-idempotent contract.
 */
export type DevicesModuleEvents = Record<string, never>;
export type DevicesModule = FeatureModule<DevicesModuleEvents>;

export function createDevicesModule(): DevicesModule {
  return defineFeatureModule<DevicesModuleEvents>({
    id: 'devices',
    displayName: 'iOS simulators',
    init: () => {
      /* no-op: controller is constructed eagerly */
    },
    dispose: () => {
      /* no-op: nothing to release */
    },
    on: () => {
      // No events; the empty `on` returns a no-op unsubscribe so callers can
      // call the conformance test's `on` check without runtime errors.
      return () => undefined;
    },
  });
}
