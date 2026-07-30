import { ProcessManager } from '../process/process-manager.js';
import {
  type AdbDevice,
  type AdbExecutor,
  makeProcessAdbExecutor,
  parseAdbDevices,
} from './android-adb.js';
import {
  makeProcessSimctlExecutor,
  parseSimctlListDevices,
  type SimDevice,
  type SimctlExecutor,
} from './ios-simctl.js';

/**
 * Owns the device/simulator/emulator lifecycle for one app (E-09 / E-22). Discovers
 * iOS simulators via `simctl` AND Android devices/emulators via `adb` (TD-13), boots
 * them, installs app bundles, and launches them. Pure (no direct side effects) —
 * both executors are injected so tests don't need `xcrun` / `adb` on PATH.
 *
 * Per NG-7 we are macOS-first; the `SimctlExecutor` only runs on macOS, but the
 * `AdbExecutor` runs on macOS, Linux, and Windows (where `adb` ships with Android
 * platform-tools). Both executors are independently optional — the controller merges
 * the results from whichever are present and registered.
 */
export interface DevicesControllerDeps {
  readonly processes: ProcessManager;
  /** Injected iOS simctl executor; defaults to a `xcrun simctl`-backed one. */
  readonly simctlExecutor?: SimctlExecutor;
  /** Injected Android adb executor; defaults to an `adb`-backed one. */
  readonly adbExecutor?: AdbExecutor;
}

/**
 * Unified device shape surfaced to the UI. Discriminated on `family` so the renderer
 * can label and color the rows without inspecting runtime-specific fields.
 */
export type Device = IosSimDevice | AndroidDevice;

/** iOS simulator row (mirrors `SimDevice` but tagged with the family). */
export type IosSimDevice = SimDevice & { readonly family: 'ios' };
/** Android device/emulator row (mirrors `AdbDevice` but tagged with the family). */
export type AndroidDevice = AdbDevice & { readonly family: 'android' };

export class DevicesController {
  readonly #deps: DevicesControllerDeps;
  #simctl: SimctlExecutor | null = null;
  #adb: AdbExecutor | null = null;
  #devices: Device[] = [];
  readonly #listHandlers = new Set<(devices: readonly Device[]) => void>();

  constructor(deps: DevicesControllerDeps) {
    this.#deps = deps;
  }

  /**
   * Re-scan the device inventory (iOS simctl + Android adb). Returns the merged list
   * (also cached for subsequent calls without an explicit `refresh: true`). Pure:
   * doesn't boot or install anything. Either executor is allowed to fail — the
   * surviving family is still returned (Android users don't have `xcrun`; we don't
   * make them lose the device list because of it).
   */
  async list(options: { refresh?: boolean } = {}): Promise<Device[]> {
    if (!options.refresh && this.#devices.length > 0) return this.#devices;
    const [ios, android] = await Promise.all([this.#scanIos(), this.#scanAndroid()]);
    this.#setDevices([...ios, ...android]);
    return this.#devices;
  }

  /** Boot an iOS simulator by UDID. Resolves once `simctl boot` returns. */
  async boot(udid: string): Promise<void> {
    await this.simctl.boot(udid);
    // The boot call returns before the device is actually Booted — refresh inventory
    // so the UI sees the new state on the next list(). Done best-effort; failure here
    // is non-fatal (the user can refresh manually).
    try {
      const ios = await this.#scanIos();
      this.#setDevices([...ios, ...this.#androidOnly()]);
    } catch {
      /* swallow */
    }
  }

  /**
   * Subscribe to inventory changes (E-09). Fires whenever `list()`/`boot()` refreshes
   * the device set — the live "trigger" the auto-attach policy (TD-16) needs to react
   * to a device appearing/booting. Returns an unsubscribe.
   */
  onList(handler: (devices: readonly Device[]) => void): () => void {
    this.#listHandlers.add(handler);
    return () => {
      this.#listHandlers.delete(handler);
    };
  }

  /** Replace the cached inventory and notify `onList` subscribers. */
  #setDevices(devices: Device[]): void {
    this.#devices = devices;
    for (const handler of this.#listHandlers) handler(this.#devices);
  }

  /** Install an .app bundle onto an iOS simulator. */
  async install(udid: string, appPath: string): Promise<void> {
    await this.simctl.install(udid, appPath);
  }

  /**
   * Install an .apk onto an Android device/emulator. Replaces any previously-installed
   * copy of the same package (`adb install -r`). Resolves once `adb` exits; the user
   * sees the result via the UI's busy state and any error message.
   */
  async installApk(serial: string, apkPath: string): Promise<void> {
    await this.adb.install(serial, apkPath);
  }

  /**
   * Launch an installed app on an iOS simulator. Returns the new PID as a string
   * (simctl prints it on stdout, with trailing newline). Throws if simctl exits
   * non-zero.
   */
  async launch(udid: string, bundleId: string): Promise<string> {
    return (await this.simctl.launch(udid, bundleId)).trim();
  }

  /**
   * Launch an installed app's main activity on an Android device/emulator. The caller
   * is responsible for knowing `pkg/activity` (typically `pkg/.MainActivity`); the
   * controller does not parse `AndroidManifest.xml` in this thin slice. Resolves with
   * the `adb shell am start` stdout (`Starting: Intent { ... }`).
   */
  async launchActivity(serial: string, pkg: string, activity: string): Promise<string> {
    return (await this.adb.launch(serial, pkg, activity)).trim();
  }

  /** Cached devices (or empty if list() hasn't been called yet). */
  get devices(): readonly Device[] {
    return this.#devices;
  }

  private get simctl(): SimctlExecutor {
    if (this.#simctl === null) {
      this.#simctl = this.#deps.simctlExecutor ?? makeProcessSimctlExecutor(this.#deps.processes);
    }
    return this.#simctl;
  }

  private get adb(): AdbExecutor {
    if (this.#adb === null) {
      this.#adb = this.#deps.adbExecutor ?? makeProcessAdbExecutor(this.#deps.processes);
    }
    return this.#adb;
  }

  async #scanIos(): Promise<IosSimDevice[]> {
    try {
      const json = await this.simctl.listDevices();
      return parseSimctlListDevices(json)
        .filter((d) => d.isAvailable)
        .map((d): IosSimDevice => ({ ...d, family: 'ios' }));
    } catch {
      return [];
    }
  }

  async #scanAndroid(): Promise<AndroidDevice[]> {
    try {
      const out = await this.adb.listDevices();
      return parseAdbDevices(out).map((d): AndroidDevice => ({ ...d, family: 'android' }));
    } catch {
      return [];
    }
  }

  #androidOnly(): AndroidDevice[] {
    return this.#devices.filter((d): d is AndroidDevice => d.family === 'android');
  }
}
