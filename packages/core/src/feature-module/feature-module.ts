/**
 * The FeatureModule contract (E-05, ADR-0007). Extracted from the real shared shape
 * of the Metro (E-08), Devices (E-09), and Logs (E-10) modules — the rule of three
 * has finally fired, so the abstraction is grounded in actual code, not invented
 * speculatively.
 *
 * A FeatureModule is the unit of "a thing Icarus can do." The walking skeleton
 * already has three of them (the modules above); E-05 establishes the interface
 * they conform to so the NEXT module is mostly self-contained.
 *
 * Contract overview (a FeatureModule must):
 *   - have a stable, unique \`id\` (used for IPC channel names, log lines, etc.)
 *   - implement \`init(ctx)\` — wires up state, registers handlers, returns
 *     disposable subscriptions
 *   - implement \`dispose()\` — releases everything; idempotent
 *   - emit typed events (the shape is module-specific — \`ModuleEvents\`)
 *   - own no Electron, no filesystem, no I/O outside the injected \`ModuleContext\`
 *
 * The conformance test kit (see feature-module.test.ts) provides a small set of
 * property checks any FeatureModule must pass: id is non-empty, init returns
 * without throwing, dispose is idempotent, and the event-bus handlers don't
 * retain references after dispose.
 *
 * ADR-0007 note: the original plan was to extract this in M0 and build a throwaway
 * example module. The deferred-instead approach (rule of three) means we ship the
 * interface here, with three real modules as evidence, and skip the example
 * module — the real modules ARE the example.
 */

/** What the runtime injects into a module when it starts up. */
export interface ModuleContext {
  /** ProcessManager shared across the app — modules use it for any spawn. */
  readonly processes: import('../process/process-manager.js').ProcessManager;
  /**
   * Register a typed event subscription. The runtime will dispose it when the
   * module is disposed. Modules can also keep their own Unsubscribe[] for
   * resources that don't fit the registry.
   */
  onDispose(disposable: () => void): void;
  /**
   * Surface a module-level warning or info message to the user. Surfaces via the
   * unified log stream when wired to E-10; for v1 the implementation may just
   * console.log.
   */
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

/** Base shape every module must satisfy. Parameterized over the event map. */
export interface FeatureModule<Events extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable, unique, kebab-case id (e.g. 'metro', 'devices', 'logs'). */
  readonly id: string;
  /** Human-readable name for the UI. */
  readonly displayName: string;
  /**
   * The runtime list of event names this module emits via `on(...)`. The
   * TypeScript `Events` map is erased at runtime, so the registry needs this
   * explicit list to auto-wire IPC channels (TD-15): a runtime with no way to
   * enumerate `keyof Events` can't bind a module's events generically. A module
   * with no event stream (e.g. command-only `devices`) declares `[]`.
   */
  readonly events: readonly (keyof Events & string)[];
  /**
   * Start the module. Should be cheap to call (no I/O if the module has nothing
   * to do until the user acts). The runtime may call init() more than once across
   * the app's lifetime (e.g. after a settings change); the module must be idempotent.
   */
  init(ctx: ModuleContext): Promise<void> | void;
  /**
   * Stop the module. Must be idempotent. Must release all subscriptions the
   * module registered via \`ctx.onDispose\` AND any internal ones.
   */
  dispose(): Promise<void> | void;
  /**
   * Subscribe to a module event. Events are typed at the call site. Returns an
   * unsubscribe function. The runtime must also clear these on dispose.
   */
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void;
}

/**
 * Convenience constructor: builds a FeatureModule from a smaller object. The
 * runtime uses this to wrap a bare controller (Metro, Devices, Logs) into a
 * FeatureModule without each module having to repeat the boilerplate.
 */
export function defineFeatureModule<Events extends Record<string, unknown>>(spec: {
  id: string;
  displayName: string;
  /** Event names the module emits. Defaults to `[]` for command-only modules. */
  events?: readonly (keyof Events & string)[];
  init: (ctx: ModuleContext) => Promise<void> | void;
  dispose: () => Promise<void> | void;
  on: <K extends keyof Events>(event: K, handler: (payload: Events[K]) => void) => () => void;
}): FeatureModule<Events> {
  return {
    id: spec.id,
    displayName: spec.displayName,
    events: spec.events ?? [],
    init: spec.init,
    dispose: spec.dispose,
    on: spec.on,
  };
}
