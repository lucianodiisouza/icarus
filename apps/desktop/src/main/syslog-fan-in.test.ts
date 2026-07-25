import { describe, expect, it, vi } from 'vitest';
import { InMemoryNativeLogSource, type UnifiedLogController } from '@icarus/core';
import { SyslogFanIn } from './syslog-fan-in.js';

function setup() {
  const pushNative = vi.fn();
  const unified = { pushNative } as unknown as Pick<UnifiedLogController, 'pushNative'>;
  const sources = new Map<string, InMemoryNativeLogSource>();
  const createSource = vi.fn((udid: string) => {
    const source = new InMemoryNativeLogSource();
    source.start();
    sources.set(udid, source);
    return source;
  });
  const fanIn = new SyslogFanIn({ unified, createSource });
  return { fanIn, pushNative, sources, createSource };
}

describe('SyslogFanIn', () => {
  it('streams the booted simulator’s lines into unified.pushNative', () => {
    const { fanIn, pushNative, sources } = setup();
    fanIn.start('udid-A');
    expect(fanIn.activeUdid).toBe('udid-A');

    sources.get('udid-A')!.emit('2026-07-25 log: hello from sim');
    expect(pushNative).toHaveBeenCalledWith('2026-07-25 log: hello from sim');
  });

  it('booting the same udid twice does not restart the stream', () => {
    const { fanIn, createSource } = setup();
    fanIn.start('udid-A');
    fanIn.start('udid-A');
    expect(createSource).toHaveBeenCalledTimes(1);
  });

  it('booting a different sim replaces the stream (one at a time)', async () => {
    const { fanIn, pushNative, sources } = setup();
    fanIn.start('udid-A');
    fanIn.start('udid-B');
    expect(fanIn.activeUdid).toBe('udid-B');

    // The old source is stopped and detached — its lines no longer reach unified.
    expect(sources.get('udid-A')!.isRunning()).toBe(false);
    sources.get('udid-A')!.emit('stale line from A');
    expect(pushNative).not.toHaveBeenCalled();

    sources.get('udid-B')!.emit('fresh line from B');
    expect(pushNative).toHaveBeenCalledTimes(1);
    expect(pushNative).toHaveBeenCalledWith('fresh line from B');
  });

  it('stop() detaches and halts the active stream; idempotent', async () => {
    const { fanIn, pushNative, sources } = setup();
    fanIn.start('udid-A');
    await fanIn.stop();
    expect(fanIn.activeUdid).toBeNull();
    expect(sources.get('udid-A')!.isRunning()).toBe(false);

    sources.get('udid-A')!.emit('after stop');
    expect(pushNative).not.toHaveBeenCalled();
    await expect(fanIn.stop()).resolves.toBeUndefined();
  });
});
