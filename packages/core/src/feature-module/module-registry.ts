import type { FeatureModule, ModuleContext } from './feature-module.js';

/**
 * The runtime side of the FeatureModule contract (TD-15, E-05 follow-up).
 * Owns a list of registered modules, runs their `init(ctx)` on construction,
 * and runs their `dispose()` on `disposeAll()`. The context injected into each
 * module shares the app's `ProcessManager` and a per-module dispose registry
 * so modules don't need to track their own cleanups.
 *
 * The "adding a new module needs no core changes" DoD lives here: a new
 * feature module is one line — \`registry.register(createFooModule())\` —
 * and the registry handles init, dispose, and the per-module cleanup trail.
 * No changes to the IPC router, the preload bridge, or the renderer are
 * needed for the new module to participate in the lifecycle.
 *
 * The registry stays Electron-free and lifecycle-only: it does not itself touch
 * IPC. But it is the enumeration point the IPC layer needs — each module
 * declares its runtime \`events\` list, and the desktop shell's
 * \`bindRegistryToWindow\` iterates \`list()\` to auto-wire every module's events
 * to a window (TD-15). That split keeps \`core\` free of Electron while still
 * making "add a module → its events reach the renderer" a zero-core-change,
 * one-liner registration.
 */
export class ModuleRegistry {
  readonly #modules: FeatureModule<Record<string, unknown>>[] = [];
  readonly #disposables = new Map<FeatureModule<Record<string, unknown>>, Array<() => void>>();
  readonly #log: (level: 'info' | 'warn' | 'error', message: string) => void;

  constructor(opts: { log?: (level: 'info' | 'warn' | 'error', message: string) => void } = {}) {
    // Default to a no-op logger so the registry is usable in isolation (tests).
    this.#log = opts.log ?? (() => undefined);
  }

  /**
   * Register a module. Calls \`init(ctx)\` immediately. The context is built
   * per-module so each module gets its OWN dispose trail (no cross-module
   * leaks if one module's init throws).
   */
  register<Events extends Record<string, unknown>>(
    module: FeatureModule<Events>,
    ctx: Omit<ModuleContext, 'onDispose' | 'log'> & {
      processes: import('../process/process-manager.js').ProcessManager;
    },
  ): void {
    const disposables: Array<() => void> = [];
    // Cast through the unknown-erased FeatureModule so the heterogeneous
    // module list typechecks. The runtime doesn't care about Events — it just
    // calls init / dispose and stores the disposables.
    const anyModule = module as unknown as FeatureModule<Record<string, unknown>>;
    const moduleCtx: ModuleContext = {
      ...ctx,
      onDispose: (d) => {
        disposables.push(d);
      },
      log: (level, message) => {
        this.#log(level, `[${module.id}] ${message}`);
      },
    };
    this.#modules.push(anyModule);
    this.#disposables.set(anyModule, disposables);
    // init is allowed to be async; we don't await here. The conformance test
    // ensures init returns without throwing; the registry surfaces errors
    // via the logger.
    Promise.resolve()
      .then(() => module.init(moduleCtx))
      .catch((err) => {
        this.#log('error', `init failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  /** The currently-registered modules (in registration order). */
  list(): readonly FeatureModule[] {
    return [...this.#modules];
  }

  /**
   * Dispose every registered module in REVERSE order. Each module's
   * per-module disposables are called first, then the module's own
   * \`dispose()\`. Idempotent: a second call is a no-op.
   */
  async disposeAll(): Promise<void> {
    for (let i = this.#modules.length - 1; i >= 0; i -= 1) {
      const anyModule = this.#modules[i];
      if (!anyModule) continue;
      const disposables = this.#disposables.get(anyModule) ?? [];
      for (const d of disposables) {
        try {
          d();
        } catch {
          /* swallow per-disposable failures so one bad cleanup doesn't block the rest */
        }
      }
      try {
        await anyModule.dispose();
      } catch {
        /* swallow */
      }
      this.#disposables.delete(anyModule);
    }
    this.#modules.length = 0;
  }
}
