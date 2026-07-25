import { describe, expect, it, vi } from 'vitest';
import { UnifiedLogController } from './unified-log-controller.js';
import type { CdpConsoleEntry } from '../protocol/cdp/console.js';

const cdpEntry: CdpConsoleEntry = {
  level: 'error',
  text: 'boom',
  timestampMs: 1000,
};

describe('UnifiedLogController', () => {
  it('fans each pushed source to every subscriber, tagged with its source', () => {
    const controller = new UnifiedLogController();
    const a = vi.fn();
    const b = vi.fn();
    controller.onEntry(a);
    controller.onEntry(b);

    controller.pushCdp(cdpEntry);
    controller.pushMetro('stderr', 'metro error', 42);

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
    expect(a.mock.calls[0]?.[0]).toMatchObject({ source: 'cdp', text: 'boom' });
    expect(a.mock.calls[1]?.[0]).toMatchObject({ source: 'metro', text: 'metro error' });
  });

  it('pushCdp / pushMetro return the fused entry to the caller', () => {
    const controller = new UnifiedLogController();
    expect(controller.pushCdp(cdpEntry)).toMatchObject({ source: 'cdp', level: 'error' });
    expect(controller.pushMetro('stdout', 'hi', 7)).toMatchObject({
      source: 'metro',
      text: 'hi',
      timestampMs: 7,
    });
  });

  it('pushNative emits normalized lines and returns null for unparseable ones', () => {
    const controller = new UnifiedLogController();
    const handler = vi.fn();
    controller.onEntry(handler);

    const parsed = controller.pushNative('2026-07-25 12:00:00.000 App error: kaboom');
    expect(parsed).toMatchObject({ source: 'native', level: 'error', text: 'kaboom' });
    expect(handler).toHaveBeenCalledTimes(1);

    // A line with no recognizable level token can't be normalized → null, not emitted.
    expect(controller.pushNative('just some noise with no level token')).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('onEntry returns an unsubscribe that stops further delivery', () => {
    const controller = new UnifiedLogController();
    const handler = vi.fn();
    const off = controller.onEntry(handler);
    controller.pushMetro('stdout', 'first', 1);
    off();
    controller.pushMetro('stdout', 'second', 2);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dispose clears all subscribers; subsequent pushes reach no one', () => {
    const controller = new UnifiedLogController();
    const handler = vi.fn();
    controller.onEntry(handler);
    controller.dispose();
    controller.pushMetro('stdout', 'after dispose', 1);
    expect(handler).not.toHaveBeenCalled();
  });
});
