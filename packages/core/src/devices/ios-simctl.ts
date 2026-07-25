/**
 * iOS simulator support (E-09). Thin wrapper around `xcrun simctl` — the only way to
 * enumerate, boot, install, and launch iOS simulators from a script on macOS. We do NOT
 * call `simctl` directly from the renderer or anywhere else; this module is the single
 * chokepoint so we can:
 *   - inject the executor in tests (no real simctl invocation)
 *   - parse the documented JSON output in one place
 *   - change platforms (e.g. add adb for Android) by swapping the executor, not the
 *     call sites.
 *
 * Per NG-7 we are macOS-first; Linux/Windows simulator support is out of scope for
 * v1 — those platforms will get their own executor when needed. The `isAvailable`
 * check on each device is what we surface in the UI to hide devices that can't be
 * booted (e.g. wrong runtime, missing xcode).
 *
 * Pure (no side effects) and Electron-free (ADR-0002): every I/O function takes a
 * `SimctlExecutor` so tests can return canned output.
 */
import { ManagedProcess } from '../process/managed-process.js';
import { ProcessManager } from '../process/process-manager.js';
import type { ExitInfo } from '../process/types.js';

/** A single simulator as reported by `simctl list devices --json`. */
export interface SimDevice {
  readonly udid: string;
  readonly name: string;
  /** One of: Booted, Booting, ShuttingDown, Shutdown, etc. */
  readonly state: string;
  /** The runtime identifier, e.g. "com.apple.CoreSimulator.SimRuntime.iOS-18-0". */
  readonly runtime: string;
  /** True if the device is available to boot (matches the device's runtime, etc.). */
  readonly isAvailable: boolean;
}

/**
 * Executor interface — every I/O goes through this. Production wires it to the real
 * `xcrun simctl` via ProcessManager; tests inject a fake.
 */
export interface SimctlExecutor {
  /** Run `xcrun simctl list devices --json` and return stdout. */
  listDevices(): Promise<string>;
  /** Run `xcrun simctl boot <udid>` and resolve when it returns (does NOT wait for boot). */
  boot(udid: string): Promise<ExitInfo>;
  /** Run `xcrun simctl install <udid> <appPath>`. */
  install(udid: string, appPath: string): Promise<ExitInfo>;
  /** Run `xcrun simctl launch <udid> <bundleId>`. Resolves with stdout (the new PID). */
  launch(udid: string, bundleId: string): Promise<string>;
}

/** Shape of the subset of `simctl list devices --json` we care about. */
interface SimctlListJson {
  readonly devices: Readonly<Record<string, readonly SimctlDeviceJson[]>>;
}
interface SimctlDeviceJson {
  readonly udid: string;
  readonly name: string;
  readonly state: string;
  readonly isAvailable?: boolean;
  readonly deviceTypeIdentifier?: string;
}

/** Parse the JSON output of `simctl list devices --json`. */
export function parseSimctlListDevices(json: string): SimDevice[] {
  let parsed: SimctlListJson;
  try {
    parsed = JSON.parse(json) as SimctlListJson;
  } catch {
    return [];
  }
  const out: SimDevice[] = [];
  for (const [runtime, devices] of Object.entries(parsed.devices ?? {})) {
    for (const d of devices) {
      out.push({
        udid: d.udid,
        name: d.name,
        state: d.state,
        runtime,
        isAvailable: d.isAvailable ?? true,
      });
    }
  }
  return out;
}

/** Production executor — runs `xcrun simctl` via a real ProcessManager. */
export function makeProcessSimctlExecutor(processes: ProcessManager): SimctlExecutor {
  return {
    listDevices: () =>
      runAndCollectStdout(processes, ['xcrun', 'simctl', 'list', 'devices', '--json']),
    boot: (udid) => runAndWait(processes, ['xcrun', 'simctl', 'boot', udid]),
    install: (udid, appPath) =>
      runAndWait(processes, ['xcrun', 'simctl', 'install', udid, appPath]),
    launch: async (udid, bundleId) => {
      const out = await runAndCollectStdout(processes, [
        'xcrun',
        'simctl',
        'launch',
        udid,
        bundleId,
      ]);
      return out.trim();
    },
  };
}

async function runAndWait(processes: ProcessManager, argv: readonly string[]): Promise<ExitInfo> {
  const proc = processes.spawn({
    id: `simctl-${argv.slice(1).join('-')}-${Date.now()}`,
    command: argv[0] ?? '',
    args: argv.slice(1),
    shutdown: { signal: 'SIGTERM', graceMs: 5000 },
  });
  try {
    return await proc.waitExit();
  } catch (error) {
    // The process errored or we couldn't wait for it. The caller will surface the message.
    throw new Error(
      `simctl ${argv.slice(1).join(' ')} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function runAndCollectStdout(
  processes: ProcessManager,
  argv: readonly string[],
): Promise<string> {
  const proc: ManagedProcess = processes.spawn({
    id: `simctl-${argv.slice(1).join('-')}-${Date.now()}`,
    command: argv[0] ?? '',
    args: argv.slice(1),
    shutdown: { signal: 'SIGTERM', graceMs: 5000 },
  });
  const info = await proc.waitExit();
  if (info.code !== 0) {
    throw new Error(
      `simctl ${argv.slice(1).join(' ')} exited with code=${info.code}: ${proc.stderr.lines().at(-1) ?? ''}`,
    );
  }
  return proc.stdout.lines().join('\n');
}
