import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { bindIpcForModuleEvents, eventChannelFor } from './feature-module-bridge.js';
import { defineFeatureModule, type FeatureModule } from '@icarus/core';

function makeFakeWindow() {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const window = {
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: vi.fn((channel: string, payload: unknown) => {
        sent.push({ channel, payload });
      }),
    },
  } as unknown as BrowserWindow;
  return { window, sent };
}

type DemoEvents = { ping: number; pong: string };
type Demo = FeatureModule<DemoEvents>;

function makeDemoModule(): Demo {
  return defineFeatureModule<DemoEvents>({
    id: 'demo',
    displayName: 'Demo',
    init: () => undefined,
    dispose: () => undefined,
    on: () => () => undefined,
  });
}

describe('eventChannelFor', () => {
  it('builds a deterministic channel name from module + event', () => {
    expect(eventChannelFor('metro', 'log')).toBe('module.metro.event.log');
    expect(eventChannelFor('unified-log', 'log')).toBe('module.unified-log.event.log');
  });
});

describe('bindIpcForModuleEvents', () => {
  it('pushes subscribed events to webContents with the expected channel + envelope', () => {
    const { window, sent } = makeFakeWindow();
    const module = makeDemoModule();
    // Replace `on` with a fake that captures subscribers so the test can fire events.
    const subscribers = new Map<string, (payload: unknown) => void>();
    (
      module as {
        on: <K extends keyof DemoEvents>(e: K, h: (p: DemoEvents[K]) => void) => () => void;
      }
    ).on = vi.fn((event, handler) => {
      subscribers.set(event as string, handler as (payload: unknown) => void);
      return () => subscribers.delete(event as string);
    });

    const now = () => 1_700_000_000_000;
    const off = bindIpcForModuleEvents(module, ['ping', 'pong'], { window, now });

    // Fire a 'ping' event.
    subscribers.get('ping')?.(42);
    expect(sent).toEqual([
      {
        channel: 'module.demo.event.ping',
        payload: { timestampMs: 1_700_000_000_000, payload: 42 },
      },
    ]);

    // Fire a 'pong' event.
    subscribers.get('pong')?.('hello');
    expect(sent).toEqual([
      {
        channel: 'module.demo.event.ping',
        payload: { timestampMs: 1_700_000_000_000, payload: 42 },
      },
      {
        channel: 'module.demo.event.pong',
        payload: { timestampMs: 1_700_000_000_000, payload: 'hello' },
      },
    ]);

    // Unsubscribe — subsequent events don't fire.
    off();
    subscribers.get('ping')?.(99);
    expect(sent).toHaveLength(2);
  });

  it('skips send() when the window is destroyed', () => {
    const { window, sent } = makeFakeWindow();
    (window as unknown as { isDestroyed: () => boolean }).isDestroyed = () => true;
    const module = makeDemoModule();
    const subscribers = new Map<string, (payload: unknown) => void>();
    (
      module as {
        on: <K extends keyof DemoEvents>(e: K, h: (p: DemoEvents[K]) => void) => () => void;
      }
    ).on = vi.fn((event, handler) => {
      subscribers.set(event as string, handler as (payload: unknown) => void);
      return () => undefined;
    });
    const off = bindIpcForModuleEvents(module, ['ping'], { window });
    subscribers.get('ping')?.(1);
    expect(sent).toEqual([]);
    off();
  });

  it('idempotent unsubscribe: calling off() twice is a no-op', () => {
    const { window } = makeFakeWindow();
    const module = makeDemoModule();
    const off = bindIpcForModuleEvents(module, [], { window });
    off();
    expect(() => off()).not.toThrow();
  });
});
