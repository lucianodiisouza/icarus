import { ProcessManager } from '../process/process-manager.js';
import {
  makeProcessSimctlExecutor,
  parseSimctlListDevices,
  type SimDevice,
  type SimctlExecutor,
} from './ios-simctl.js';

/**
 * Owns the device/simulator lifecycle for one app (E-09). Discovers available iOS
 * simulators via `simctl`, boots them, installs app bundles, and launches them. Pure
 * (no direct side effects) — the `SimctlExecutor` is injected so tests don't need
 * `xcrun` on PATH.
 *
 * Per NG-7 we are macOS-first: this controller ships iOS only for v1. The
 * SimctlExecutor interface is small enough that adding an adb-backed Android
 * executor is a follow-up that doesn't touch the call sites.
 */
export interface DevicesControllerDeps {
  readonly processes: ProcessManager;
  /** Injected executor; defaults to a `xcrun simctl`-backed one. */
  readonly executor?: SimctlExecutor;
}

export class DevicesController {
  readonly #deps: DevicesControllerDeps;
  #executor: SimctlExecutor | null = null;
  #devices: SimDevice[] = [];

  constructor(deps: DevicesControllerDeps) {
    this.#deps = deps;
  }

  /**
   * Re-scan the simulator inventory. Returns the list (also cached for subsequent
   * calls without an explicit `refresh: true`). Pure: doesn't boot or install anything.
   */
  async list(options: { refresh?: boolean } = {}): Promise<SimDevice[]> {
    if (!options.refresh && this.#devices.length > 0) return this.#devices;
    const executor = this.executor;
    const json = await executor.listDevices();
    this.#devices = parseSimctlListDevices(json).filter((d) => d.isAvailable);
    return this.#devices;
  }

  /** Boot a simulator by UDID. Resolves once `simctl boot` returns. */
  async boot(udid: string): Promise<void> {
    await this.executor.boot(udid);
    // The boot call returns before the device is actually Booted — refresh inventory
    // so the UI sees the new state on the next list(). Done best-effort; failure here
    // is non-fatal (the user can refresh manually).
    try {
      this.#devices = parseSimctlListDevices(await this.executor.listDevices()).filter(
        (d) => d.isAvailable,
      );
    } catch {
      /* swallow */
    }
  }

  /** Install an .app bundle onto a simulator. */
  async install(udid: string, appPath: string): Promise<void> {
    await this.executor.install(udid, appPath);
  }

  /**
   * Launch an installed app on a simulator. Returns the new PID as a string (simctl
   * prints it on stdout, with trailing newline). Throws if simctl exits non-zero.
   */
  async launch(udid: string, bundleId: string): Promise<string> {
    return (await this.executor.launch(udid, bundleId)).trim();
  }

  /** Cached devices (or empty if list() hasn't been called yet). */
  get devices(): readonly SimDevice[] {
    return this.#devices;
  }

  private get executor(): SimctlExecutor {
    if (this.#executor === null) {
      this.#executor = this.#deps.executor ?? makeProcessSimctlExecutor(this.#deps.processes);
    }
    return this.#executor;
  }
}
