import { describe, expect, it, vi } from 'vitest';
import { DebugContextStore } from './debug-context-store.js';

type Slices = {
  devices: string[];
  logs: { line: string }[];
};

describe('DebugContextStore', () => {
  it('returns undefined for an unset slice and the value after set', () => {
    const store = new DebugContextStore<Slices>();
    expect(store.get('devices')).toBeUndefined();
    store.set('devices', ['iPhone 17 Pro']);
    expect(store.get('devices')).toEqual(['iPhone 17 Pro']);
  });

  it('snapshot reflects all set slices and is a copy', () => {
    const store = new DebugContextStore<Slices>();
    store.set('devices', ['a']);
    store.set('logs', [{ line: 'hi' }]);

    const snap = store.snapshot();
    expect(snap).toEqual({ devices: ['a'], logs: [{ line: 'hi' }] });

    // Mutating the snapshot object does not affect the store.
    delete (snap as Record<string, unknown>).devices;
    expect(store.get('devices')).toEqual(['a']);
  });

  it('notifies subscribers with the changed key', () => {
    const store = new DebugContextStore<Slices>();
    const handler = vi.fn();
    store.subscribe(handler);

    store.set('devices', ['x']);
    store.set('logs', []);

    expect(handler).toHaveBeenNthCalledWith(1, 'devices');
    expect(handler).toHaveBeenNthCalledWith(2, 'logs');
  });

  it('unsubscribe stops notifications', () => {
    const store = new DebugContextStore<Slices>();
    const handler = vi.fn();
    const off = store.subscribe(handler);

    off();
    store.set('devices', ['x']);

    expect(handler).not.toHaveBeenCalled();
  });
});
