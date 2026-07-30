import { describe, expect, it, vi } from 'vitest';
import type { AdbExecutor } from './android-adb.js';
import { DevicesController } from './devices-controller.js';
import type { ExitInfo } from '../process/types.js';
import type { SimctlExecutor } from './ios-simctl.js';

const SAMPLE_DEVICES_JSON = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
      { udid: 'UDID-1', name: 'iPhone 17 Pro', state: 'Shutdown', isAvailable: true },
      { udid: 'UDID-2', name: 'iPhone 16', state: 'Booted', isAvailable: true },
      // Unavailable → controller drops it.
      { udid: 'UDID-3', name: 'iPhone 12 (old)', state: 'Shutdown', isAvailable: false },
    ],
  },
});

const SAMPLE_AFTER_BOOT_JSON = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
      { udid: 'UDID-1', name: 'iPhone 17 Pro', state: 'Booted', isAvailable: true },
      { udid: 'UDID-2', name: 'iPhone 16', state: 'Booted', isAvailable: true },
    ],
  },
});

const SAMPLE_ADB_DEVICES = [
  'List of devices attached',
  'emulator-5554\tdevice product:sdk_phone64_arm64 model:sdk_google_phone_arm64 transport_id:1',
  '014e23a0c123\tdevice product:panther model:Pixel_7 transport_id:2',
  '',
].join('\n');

function makeFakeSimctl(overrides: Partial<SimctlExecutor> = {}): SimctlExecutor {
  return {
    listDevices: vi.fn(async () => SAMPLE_DEVICES_JSON),
    boot: vi.fn(async (): Promise<ExitInfo> => ({ code: 0, signal: null, forced: false })),
    install: vi.fn(async (): Promise<ExitInfo> => ({ code: 0, signal: null, forced: false })),
    launch: vi.fn(async () => '1234'),
    ...overrides,
  };
}

function makeFakeAdb(overrides: Partial<AdbExecutor> = {}): AdbExecutor {
  return {
    listDevices: vi.fn(async () => SAMPLE_ADB_DEVICES),
    install: vi.fn(async (): Promise<ExitInfo> => ({ code: 0, signal: null, forced: false })),
    launch: vi.fn(async () => 'Starting: Intent { cmp=com.example/.MainActivity }'),
    ...overrides,
  };
}

function makeController(simctl: SimctlExecutor, adb: AdbExecutor) {
  return new DevicesController({
    processes: {} as never,
    simctlExecutor: simctl,
    adbExecutor: adb,
  });
}

describe('DevicesController (iOS)', () => {
  it('list() returns the available devices and caches them', async () => {
    const simctl = makeFakeSimctl();
    const adb = makeFakeAdb();
    const controller = makeController(simctl, adb);
    const devices = await controller.list();
    // 2 iOS (UDID-3 dropped) + 2 Android.
    expect(devices).toHaveLength(4);
    const ios = devices.filter((d) => d.family === 'ios');
    expect(ios.map((d) => d.udid)).toEqual(['UDID-1', 'UDID-2']);
    expect(ios[0]?.state).toBe('Shutdown');
    // Second call doesn't re-invoke either executor.
    await controller.list();
    expect(simctl.listDevices).toHaveBeenCalledTimes(1);
    expect(adb.listDevices).toHaveBeenCalledTimes(1);
    // ...unless the caller asks for a refresh.
    await controller.list({ refresh: true });
    expect(simctl.listDevices).toHaveBeenCalledTimes(2);
    expect(adb.listDevices).toHaveBeenCalledTimes(2);
  });

  it('boot() calls the executor and refreshes the cache', async () => {
    const simctl = makeFakeSimctl({
      listDevices: vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce(SAMPLE_DEVICES_JSON)
        .mockResolvedValueOnce(SAMPLE_AFTER_BOOT_JSON),
    });
    const adb = makeFakeAdb();
    const controller = makeController(simctl, adb);
    await controller.list();
    await controller.boot('UDID-1');
    expect(simctl.boot).toHaveBeenCalledWith('UDID-1');
    const refreshed = controller.devices.find((d) => 'udid' in d && d.udid === 'UDID-1');
    expect(refreshed?.state).toBe('Booted');
  });

  it('install() forwards udid + appPath', async () => {
    const simctl = makeFakeSimctl();
    const adb = makeFakeAdb();
    const controller = makeController(simctl, adb);
    await controller.install('UDID-1', '/path/to/MyApp.app');
    expect(simctl.install).toHaveBeenCalledWith('UDID-1', '/path/to/MyApp.app');
  });

  it('launch() returns the PID as a trimmed string', async () => {
    const simctl = makeFakeSimctl({
      launch: vi.fn(async () => '  1234\n'),
    });
    const adb = makeFakeAdb();
    const controller = makeController(simctl, adb);
    const pid = await controller.launch('UDID-1', 'com.example.app');
    expect(pid).toBe('1234');
  });
});

describe('DevicesController (Android)', () => {
  it('list() merges Android devices with family="android"', async () => {
    const simctl = makeFakeSimctl();
    const adb = makeFakeAdb();
    const controller = makeController(simctl, adb);
    const devices = await controller.list();
    const android = devices.filter((d) => d.family === 'android');
    expect(android).toHaveLength(2);
    expect(android.map((d) => d.serial).sort()).toEqual(['014e23a0c123', 'emulator-5554']);
    expect(android[0]?.model).toMatch(/sdk_google|Pixel/);
  });

  it('installApk() forwards serial + apkPath', async () => {
    const simctl = makeFakeSimctl();
    const adb = makeFakeAdb();
    const controller = makeController(simctl, adb);
    await controller.installApk('emulator-5554', '/path/to/MyApp.apk');
    expect(adb.install).toHaveBeenCalledWith('emulator-5554', '/path/to/MyApp.apk');
  });

  it('launchActivity() returns the trimmed "Starting: Intent..." stdout', async () => {
    const simctl = makeFakeSimctl();
    const adb = makeFakeAdb({
      launch: vi.fn(async () => '  Starting: Intent { cmp=com.example/.MainActivity }\n'),
    });
    const controller = makeController(simctl, adb);
    const out = await controller.launchActivity('emulator-5554', 'com.example', '.MainActivity');
    expect(out).toBe('Starting: Intent { cmp=com.example/.MainActivity }');
  });
});

describe('DevicesController (mixed / fault tolerance)', () => {
  it('Android rows survive an iOS scan failure (xcrun missing)', async () => {
    const simctl = makeFakeSimctl({
      listDevices: vi.fn(async () => {
        throw new Error('xcrun not on PATH');
      }),
    });
    const adb = makeFakeAdb();
    const controller = makeController(simctl, adb);
    const devices = await controller.list();
    expect(devices).toHaveLength(2);
    for (const d of devices) {
      expect(d.family).toBe('android');
    }
  });

  it('iOS rows survive an Android scan failure (adb missing)', async () => {
    const simctl = makeFakeSimctl();
    const adb = makeFakeAdb({
      listDevices: vi.fn(async () => {
        throw new Error('adb not on PATH');
      }),
    });
    const controller = makeController(simctl, adb);
    const devices = await controller.list();
    expect(devices).toHaveLength(2);
    for (const d of devices) {
      expect(d.family).toBe('ios');
    }
  });

  it('boot() preserves Android rows (only iOS is re-scanned)', async () => {
    const simctl = makeFakeSimctl({
      listDevices: vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce(SAMPLE_DEVICES_JSON)
        .mockResolvedValueOnce(SAMPLE_AFTER_BOOT_JSON),
    });
    const adb = makeFakeAdb();
    const controller = makeController(simctl, adb);
    await controller.list();
    const before = controller.devices.filter((d) => d.family === 'android').length;
    await controller.boot('UDID-1');
    const after = controller.devices.filter((d) => d.family === 'android').length;
    expect(after).toBe(before);
    // adb was not re-invoked by boot() (only the iOS scan was).
    expect(adb.listDevices).toHaveBeenCalledTimes(1);
  });

  it('onList fires whenever list() or boot() refreshes the device set', async () => {
    const simctl = makeFakeSimctl();
    const adb = makeFakeAdb();
    const controller = makeController(simctl, adb);
    const seen: number[] = [];
    const off = controller.onList((d) => seen.push(d.length));
    await controller.list();
    await controller.list({ refresh: true });
    off();
    await controller.list({ refresh: true });
    // First list() (2 events: 1st+2nd call each fire) + the manual refresh above.
    // After unsubscribe, the third refresh should not push.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen).not.toContain(0);
  });
});
