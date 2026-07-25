import type { FeatureModule, Unsubscribe } from '@icarus/core';
import type { BrowserWindow } from 'electron';

/**
 * The `apps/desktop` half of TD-15 (the IPC side of the ModuleRegistry story).
 * Subscribes to a FeatureModule's events and pushes them to the window's
 * `webContents` as one-way IPC messages, on a per-(module, event) channel.
 *
 * Channel naming: `module.{moduleId}.event.{eventName}` — e.g.
 * `module.metro.event.log`, `module.unified-log.event.log`. The renderer
 * subscribes via the generic `onModuleEvent(moduleId, eventName, handler)`
 * preload API, which dispatches to the right channel.
 *
 * Lifecycle: the bridge returns an `Unsubscribe` that detaches every
 * subscription. The ModuleRegistry wires this on the dispose trail
 * (via `ctx.onDispose`), so disposing the module cleans up the bridge
 * automatically. The bridge does NOT own the module's lifecycle; it just
 * adapts its events to IPC.
 *
 * Why a separate helper: the renderer-side `IcarusApi` is intentionally
 * narrow (ADR-0004 — the renderer never sees raw `ipcRenderer`). Adding a
 * single generic subscription covers any module's events without changing
 * the preload surface per-module.
 */

export function eventChannelFor(moduleId: string, eventName: string): string {
  return `module.${moduleId}.event.${eventName}`;
}

export interface IpcBridgeDeps {
  /** The Electron window that receives the IPC events. */
  readonly window: BrowserWindow;
  /**
   * Optional `now()` for deterministic timestamps on the IPC envelope
   * (tests inject a fixed function; production uses Date.now).
   */
  readonly now?: () => number;
}

/**
 * Subscribe to a module's events and forward each one as a one-way IPC message
 * to the window. The caller passes the explicit list of event names — the
 * TypeScript types don't expose `keyof Events` at runtime, so the registry
 * (which knows the module's events) is the only sensible caller.
 *
 * The IPC envelope is `{ timestampMs, payload }` so the renderer can
 * reason about ordering even if events arrive out-of-order (they don't,
 * but the envelope is cheap insurance).
 */
export function bindIpcForModuleEvents<Events extends Record<string, unknown>>(
  module: FeatureModule<Events>,
  eventNames: ReadonlyArray<keyof Events & string>,
  deps: IpcBridgeDeps,
): Unsubscribe {
  const now = deps.now ?? Date.now;
  const offs: Array<() => void> = [];

  for (const eventName of eventNames) {
    const channel = eventChannelFor(module.id, eventName);
    const off = module.on(eventName, (payload) => {
      if (deps.window.isDestroyed()) return;
      deps.window.webContents.send(channel, { timestampMs: now(), payload });
    });
    offs.push(off);
  }

  return (): void => {
    for (const off of offs) off();
    offs.length = 0;
  };
}
