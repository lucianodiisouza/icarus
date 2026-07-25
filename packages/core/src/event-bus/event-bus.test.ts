import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './event-bus.js';

type TestEvents = {
  ping: { n: number };
  done: void;
};

describe('EventBus', () => {
  it('delivers a payload to a subscribed handler', () => {
    const bus = new EventBus<TestEvents>();
    const seen: number[] = [];
    bus.on('ping', (p) => seen.push(p.n));

    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });

    expect(seen).toEqual([1, 2]);
  });

  it('does not deliver to handlers of other events', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on('done', handler);

    bus.emit('ping', { n: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe stops further delivery', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const off = bus.on('ping', handler);

    bus.emit('ping', { n: 1 });
    off();
    bus.emit('ping', { n: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('once auto-unsubscribes after the first emit', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.once('ping', handler);

    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a throwing handler does not block the others', () => {
    const bus = new EventBus<TestEvents>();
    const good = vi.fn();
    // Suppress the async rethrow from the default onHandlerError for this test.
    const errBus = new (class extends EventBus<TestEvents> {
      protected override onHandlerError(): void {
        /* swallowed for the test */
      }
    })();
    errBus.on('ping', () => {
      throw new Error('boom');
    });
    errBus.on('ping', good);

    errBus.emit('ping', { n: 1 });

    expect(good).toHaveBeenCalledTimes(1);
    void bus;
  });

  it('clear removes all handlers', () => {
    const bus = new EventBus<TestEvents>();
    bus.on('ping', vi.fn());
    bus.on('done', vi.fn());

    bus.clear();

    expect(bus.listenerCount('ping')).toBe(0);
    expect(bus.listenerCount('done')).toBe(0);
  });
});
