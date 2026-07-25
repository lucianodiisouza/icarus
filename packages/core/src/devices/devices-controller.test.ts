import { describe, expect, it, vi } from 'vitest';
import type { ExitInfo } from '../process/types.js';
import type { SimctlExecutor } from './ios-simctl.js';
import { DevicesController } from './devices-controller.js';

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

function makeFakeExecutor(overrides: Partial<SimctlExecutor> = {}): SimctlExecutor {
  return {
    listDevices: vi.fn(async () => SAMPLE_DEVICES_JSON),
    boot: vi.fn(async (): Promise<ExitInfo> => ({ code: 0, signal: null, forced: false })),
    install: vi.fn(async (): Promise<ExitInfo> => ({ code: 0, signal: null, forced: false })),
    launch: vi.fn(async () => '1234'),
    ...overrides,
  };
}

function makeController(executor: SimctlExecutor) {
  return new DevicesController({ processes: {} as never, executor });
}

describe('DevicesController', () => {
  it('list() returns the available devices and caches them', async () => {
    const executor = makeFakeExecutor();
    const controller = makeController(executor);
    const devices = await controller.list();
    expect(devices).toHaveLength(2); // UDID-3 dropped (isAvailable: false)
    expect(devices.map((d) => d.udid)).toEqual(['UDID-1', 'UDID-2']);
    expect(devices[0]?.state).toBe('Shutdown');
    // Second call doesn't re-invoke the executor (the cache is the point).
    await controller.list();
    expect(executor.listDevices).toHaveBeenCalledTimes(1);
    // ...unless the caller asks for a refresh.
    await controller.list({ refresh: true });
    expect(executor.listDevices).toHaveBeenCalledTimes(2);
  });

  it('boot() calls the executor and refreshes the cache', async () => {
    // First list() → Shutdown. boot(UDID-1) → re-list returns Booted.
    const executor = makeFakeExecutor({
      listDevices: vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce(SAMPLE_DEVICES_JSON)
        .mockResolvedValueOnce(SAMPLE_AFTER_BOOT_JSON),
    });
    const controller = makeController(executor);
    await controller.list();
    await controller.boot('UDID-1');
    expect(executor.boot).toHaveBeenCalledWith('UDID-1');
    const refreshed = controller.devices.find((d) => d.udid === 'UDID-1');
    expect(refreshed?.state).toBe('Booted');
  });

  it('install() forwards udid + appPath', async () => {
    const executor = makeFakeExecutor();
    const controller = makeController(executor);
    await controller.install('UDID-1', '/path/to/MyApp.app');
    expect(executor.install).toHaveBeenCalledWith('UDID-1', '/path/to/MyApp.app');
  });

  it('launch() returns the PID as a trimmed string', async () => {
    const executor = makeFakeExecutor();
    const controller = makeController(executor);
    const pid = await controller.launch('UDID-1', 'com.example.app');
    expect(pid).toBe('1234');
    expect(executor.launch).toHaveBeenCalledWith('UDID-1', 'com.example.app');
  });

  it('install() failure surfaces a useful error (no silent swallow)', async () => {
    const executor = makeFakeExecutor({
      install: vi.fn(async () => {
        throw new Error('simctl install exited with code=1');
      }),
    });
    const controller = makeController(executor);
    await expect(controller.install('UDID-1', '/bad.app')).rejects.toThrow(/exited with code=1/);
  });
});
