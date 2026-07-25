import { describe, expect, it, vi } from 'vitest';
import { AutoAttach, shouldAutoAttach } from './auto-attach.js';
import type { AutoAttachDeps } from './auto-attach.js';

function makeDeps(over: Partial<AutoAttachDeps> = {}): AutoAttachDeps & {
  cdpConnect: ReturnType<typeof vi.fn>;
  setEnabled: ReturnType<typeof vi.fn>;
  isCdpBusy: ReturnType<typeof vi.fn>;
  isMetroReady: ReturnType<typeof vi.fn>;
  firstBootedSimUdid: ReturnType<typeof vi.fn>;
  isEnabled: ReturnType<typeof vi.fn>;
} {
  const deps: AutoAttachDeps = {
    isMetroReady: vi.fn(() => false),
    firstBootedSimUdid: vi.fn(() => null),
    cdpConnect: vi.fn(async () => undefined),
    isCdpBusy: vi.fn(() => false),
    isEnabled: vi.fn(() => true),
    setEnabled: vi.fn(),
    ...over,
  };
  return deps as never;
}

describe('shouldAutoAttach', () => {
  it('returns false when disabled', () => {
    expect(
      shouldAutoAttach(
        makeDeps({
          isEnabled: vi.fn(() => false),
          isMetroReady: vi.fn(() => true),
          firstBootedSimUdid: vi.fn(() => 'udid'),
        }),
      ),
    ).toBe(false);
  });

  it('returns false when Metro is not ready', () => {
    expect(
      shouldAutoAttach(
        makeDeps({
          isMetroReady: vi.fn(() => false),
          firstBootedSimUdid: vi.fn(() => 'udid'),
        }),
      ),
    ).toBe(false);
  });

  it('returns false when no sim is booted', () => {
    expect(
      shouldAutoAttach(
        makeDeps({
          isMetroReady: vi.fn(() => true),
          firstBootedSimUdid: vi.fn(() => null),
        }),
      ),
    ).toBe(false);
  });

  it('returns false when CDP is busy', () => {
    expect(
      shouldAutoAttach(
        makeDeps({
          isMetroReady: vi.fn(() => true),
          firstBootedSimUdid: vi.fn(() => 'udid'),
          isCdpBusy: vi.fn(() => true),
        }),
      ),
    ).toBe(false);
  });

  it('returns true when all preconditions met', () => {
    expect(
      shouldAutoAttach(
        makeDeps({
          isMetroReady: vi.fn(() => true),
          firstBootedSimUdid: vi.fn(() => 'udid'),
        }),
      ),
    ).toBe(true);
  });
});

describe('AutoAttach', () => {
  it('fires cdpConnect when Metro becomes ready and a sim is booted', async () => {
    const deps = makeDeps({
      isMetroReady: vi.fn(() => true),
      firstBootedSimUdid: vi.fn(() => 'udid-1'),
    });
    const metroHandlers: Array<(s: string) => void> = [];
    const auto = new AutoAttach(deps);
    auto.start({
      onMetroStatusChange: (h) => {
        metroHandlers.push(h);
        return () => undefined;
      },
      onDevicesListChange: () => () => undefined,
    });
    metroHandlers[0]?.('ready');
    await Promise.resolve();
    expect(deps.cdpConnect).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when Metro is starting (not yet ready)', async () => {
    const deps = makeDeps({
      isMetroReady: vi.fn(() => false),
      firstBootedSimUdid: vi.fn(() => 'udid-1'),
    });
    const metroHandlers: Array<(s: string) => void> = [];
    const auto = new AutoAttach(deps);
    auto.start({
      onMetroStatusChange: (h) => {
        metroHandlers.push(h);
        return () => undefined;
      },
      onDevicesListChange: () => () => undefined,
    });
    metroHandlers[0]?.('starting');
    await Promise.resolve();
    expect(deps.cdpConnect).not.toHaveBeenCalled();
  });

  it('user-disconnect stops further auto-attach attempts', async () => {
    const deps = makeDeps({
      isMetroReady: vi.fn(() => true),
      firstBootedSimUdid: vi.fn(() => 'udid-1'),
    });
    const metroHandlers: Array<(s: string) => void> = [];
    const deviceHandlers: Array<(udids: string[]) => void> = [];
    const auto = new AutoAttach(deps);
    auto.start({
      onMetroStatusChange: (h) => {
        metroHandlers.push(h);
        return () => undefined;
      },
      onDevicesListChange: (h) => {
        deviceHandlers.push(h);
        return () => undefined;
      },
    });
    metroHandlers[0]?.('ready');
    await Promise.resolve();
    expect(deps.cdpConnect).toHaveBeenCalledTimes(1);
    auto.markUserDisconnected();
    // Force the debounce so the next event would fire if it weren't for the flag.
    await new Promise((r) => setTimeout(r, 1100));
    deviceHandlers[0]?.(['udid-2']);
    await Promise.resolve();
    expect(deps.cdpConnect).toHaveBeenCalledTimes(1); // still 1, not auto-attached again
  });

  it('clearUserDisconnected re-enables auto-attach', async () => {
    const deps = makeDeps({
      isMetroReady: vi.fn(() => true),
      firstBootedSimUdid: vi.fn(() => 'udid-1'),
    });
    const metroHandlers: Array<(s: string) => void> = [];
    const deviceHandlers: Array<(udids: string[]) => void> = [];
    const auto = new AutoAttach(deps);
    auto.start({
      onMetroStatusChange: (h) => {
        metroHandlers.push(h);
        return () => undefined;
      },
      onDevicesListChange: (h) => {
        deviceHandlers.push(h);
        return () => undefined;
      },
    });
    auto.markUserDisconnected();
    auto.clearUserDisconnected();
    await new Promise((r) => setTimeout(r, 1100));
    deviceHandlers[0]?.(['udid-2']);
    await Promise.resolve();
    expect(deps.cdpConnect).toHaveBeenCalledTimes(1);
  });

  it('debounces: rapid Metro+sim events fire cdpConnect at most once per second', async () => {
    const deps = makeDeps({
      isMetroReady: vi.fn(() => true),
      firstBootedSimUdid: vi.fn(() => 'udid-1'),
    });
    const metroHandlers: Array<(s: string) => void> = [];
    const deviceHandlers: Array<(udids: string[]) => void> = [];
    const auto = new AutoAttach(deps);
    auto.start({
      onMetroStatusChange: (h) => {
        metroHandlers.push(h);
        return () => undefined;
      },
      onDevicesListChange: (h) => {
        deviceHandlers.push(h);
        return () => undefined;
      },
    });
    metroHandlers[0]?.('ready');
    metroHandlers[0]?.('ready');
    metroHandlers[0]?.('ready');
    deviceHandlers[0]?.(['udid-1']);
    await Promise.resolve();
    expect(deps.cdpConnect).toHaveBeenCalledTimes(1);
  });
});
