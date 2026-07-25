import {
  MetroController,
  type MetroLogEvent,
  type MetroStatus,
} from '../metro/metro-controller.js';
import type { ProjectKind } from '../detect-project/detect-project.js';
import { defineFeatureModule, type FeatureModule } from './feature-module.js';

/**
 * The `status` event payload. The bare controller emits only the `MetroStatus`
 * enum, but a consumer (the renderer) needs the surrounding context — port and
 * project — to render the panel without a second round-trip. The module builds
 * this snapshot from the controller's getters at emit time so the event is
 * self-contained and the IPC bridge can forward it verbatim.
 */
export interface MetroStatusSnapshot {
  readonly status: MetroStatus;
  readonly port: number | null;
  readonly projectName: string | null;
  readonly projectKind: ProjectKind;
}

/**
 * FeatureModule wrapper for MetroController (E-08). The controller owns its own
 * lifecycle (start/stop on user demand); the module's init/dispose are no-ops
 * because the controller is constructed eagerly. The event surface
 * (log / status) is exposed as the module's typed `on(...)` so the renderer
 * (or any future consumer) can subscribe uniformly.
 */
export type MetroModuleEvents = {
  log: MetroLogEvent;
  status: MetroStatusSnapshot;
};

export type MetroModule = FeatureModule<MetroModuleEvents>;

/**
 * Build the metro feature module around an existing MetroController. Kept as a
 * separate function (not a class) so the conformance test can instantiate the
 * controller in isolation and we just hand the runtime-ready adapter to the
 * registry.
 */
export function createMetroModule(
  controller: MetroController = new MetroController({ processes: undefined as never }),
): MetroModule {
  let logUnsubscribers: Array<() => void> = [];
  let statusUnsubscribers: Array<() => void> = [];

  const statusSnapshot = (): MetroStatusSnapshot => ({
    status: controller.status,
    port: controller.port,
    projectName: controller.project?.name ?? null,
    projectKind: controller.project?.kind ?? 'unknown',
  });

  return defineFeatureModule<MetroModuleEvents>({
    id: 'metro',
    displayName: 'Metro dev server',
    events: ['log', 'status'],
    init: () => {
      // Re-attach every time init runs (the registry may call init again after a
      // tear-down). Tear down any prior subscribers first so we don't double-listen.
      for (const off of logUnsubscribers) off();
      for (const off of statusUnsubscribers) off();
      logUnsubscribers = [];
      statusUnsubscribers = [];
    },
    dispose: () => {
      for (const off of logUnsubscribers) off();
      for (const off of statusUnsubscribers) off();
      logUnsubscribers = [];
      statusUnsubscribers = [];
    },
    on: (event, handler) => {
      if (event === 'log') {
        const off = controller.onLog(handler as (event: MetroLogEvent) => void);
        logUnsubscribers.push(off);
        return () => {
          off();
          logUnsubscribers = logUnsubscribers.filter((u) => u !== off);
        };
      }
      // Enrich the bare MetroStatus into a self-contained snapshot before
      // handing it to the subscriber (see MetroStatusSnapshot).
      const statusHandler = handler as (snapshot: MetroStatusSnapshot) => void;
      const off = controller.onStatus(() => statusHandler(statusSnapshot()));
      statusUnsubscribers.push(off);
      return () => {
        off();
        statusUnsubscribers = statusUnsubscribers.filter((u) => u !== off);
      };
    },
  });
}
