/**
 * Android device/emulator support (TD-13 / E-22 horizontal slice). Thin wrapper around
 * the `adb` CLI — the only way to enumerate, install, and launch on Android emulators
 * and physical devices from a script. Mirrors the iOS simctl pattern so adding
 * platforms is "another executor, not another call site" (per the comment in
 * `ios-simctl.ts`).
 *
 * Per NG-7 we ship macOS-first; the same `AdbExecutor` runs unchanged on macOS, Linux,
 * and Windows (where `adb` ships with the Android SDK platform-tools). Pure (no side
 * effects) and Electron-free (ADR-0002): every I/O function takes an `AdbExecutor` so
 * tests don't need `adb` on PATH.
 */
import { ManagedProcess } from '../process/managed-process.js';
import { ProcessManager } from '../process/process-manager.js';
import type { ExitInfo } from '../process/types.js';

/** Family discriminator for a `Device` surfaced to the UI. */
export type DeviceFamily = 'ios' | 'android';

/** A single Android device/emulator as reported by `adb devices -l`. */
export interface AdbDevice {
  /** The serial — `emulator-5554` for an emulator, `<hex>` for a physical device. */
  readonly serial: string;
  /** One of: `device`, `offline`, `unauthorized`, `no permissions`. */
  readonly state: string;
  /** Optional model identifier (`sdk_google_phone_arm64`, `Pixel 6`, etc.). */
  readonly model: string | null;
  /** Optional product name (`sdk_phone64_arm64`, etc.). */
  readonly product: string | null;
  /** Optional transport id (`1:1`, etc.). */
  readonly transportId: string | null;
  /** Always `'android'`. */
  readonly family: DeviceFamily;
}

/**
 * Executor interface — every I/O goes through this. Production wires it to the real
 * `adb` via ProcessManager; tests inject a fake.
 */
export interface AdbExecutor {
  /** Run `adb devices -l` and return stdout. */
  listDevices(): Promise<string>;
  /** Run `adb -s <serial> install <appPath>`. */
  install(serial: string, appPath: string): Promise<ExitInfo>;
  /** Run `adb -s <serial> shell am start -n <pkg>/<activity>`. Resolves with stdout (the new PID or `Starting: ...`). */
  launch(serial: string, pkg: string, activity: string): Promise<string>;
}

/**
 * Parse the text output of `adb devices -l`. The format is:
 *
 * ```
 * List of devices attached
 * emulator-5554   device product:sdk_phone64_arm64 model:sdk_google_phone_arm64 device:emu64a transport_id:1
 * 014e23a0c123    device product:panther model:Pixel_7 device:panther transport_id:2
 *
 * ```
 *
 * The trailing blank line and any `*` daemon rows are skipped. Returns only rows whose
 * `state` is one we can act on (`device` — not `offline` / `unauthorized` / `no permissions`).
 */
export function parseAdbDevices(output: string): AdbDevice[] {
  const out: AdbDevice[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('*')) continue; // daemon / advisory lines ("* daemon not running", "* waiting for device")
    if (line.toLowerCase().startsWith('list of devices')) continue;
    // Token 1 = serial, token 2 = state, then optional `key:value` pairs.
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const state = parts[1];
    if (!serial || !state) continue;
    if (state !== 'device') continue; // skip offline / unauthorized / no permissions
    let model: string | null = null;
    let product: string | null = null;
    let transportId: string | null = null;
    for (const tok of parts.slice(2)) {
      const eq = tok.indexOf(':');
      if (eq < 0) continue;
      const key = tok.slice(0, eq);
      const val = tok.slice(eq + 1);
      if (key === 'model') model = val || null;
      else if (key === 'product') product = val || null;
      else if (key === 'transport_id') transportId = val || null;
    }
    out.push({
      serial,
      state,
      model,
      product,
      transportId,
      family: 'android',
    });
  }
  return out;
}

/** Production executor — runs the real `adb` via ProcessManager. */
export function makeProcessAdbExecutor(processes: ProcessManager): AdbExecutor {
  return {
    listDevices: () => runAndCollectStdout(processes, ['adb', 'devices', '-l']),
    install: (serial, appPath) =>
      runAndWait(processes, ['adb', '-s', serial, 'install', '-r', appPath]),
    launch: async (serial, pkg, activity) => {
      return (
        await runAndCollectStdout(processes, [
          'adb',
          '-s',
          serial,
          'shell',
          'am',
          'start',
          '-n',
          `${pkg}/${activity}`,
        ])
      ).trim();
    },
  };
}

async function runAndWait(processes: ProcessManager, argv: readonly string[]): Promise<ExitInfo> {
  const proc = processes.spawn({
    id: `adb-${argv.slice(1).join('-')}-${Date.now()}`,
    command: argv[0] ?? '',
    args: argv.slice(1),
    shutdown: { signal: 'SIGTERM', graceMs: 5000 },
  });
  try {
    return await proc.waitExit();
  } catch (error) {
    throw new Error(
      `adb ${argv.slice(1).join(' ')} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function runAndCollectStdout(
  processes: ProcessManager,
  argv: readonly string[],
): Promise<string> {
  const proc: ManagedProcess = processes.spawn({
    id: `adb-${argv.slice(1).join('-')}-${Date.now()}`,
    command: argv[0] ?? '',
    args: argv.slice(1),
    shutdown: { signal: 'SIGTERM', graceMs: 5000 },
  });
  const info = await proc.waitExit();
  if (info.code !== 0) {
    throw new Error(
      `adb ${argv.slice(1).join(' ')} exited with code=${info.code}: ${proc.stderr.lines().at(-1) ?? ''}`,
    );
  }
  return proc.stdout.lines().join('\n');
}
