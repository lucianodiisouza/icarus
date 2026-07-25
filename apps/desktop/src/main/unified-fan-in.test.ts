import { describe, expect, it, vi } from 'vitest';
import type { MetroController, UnifiedLogController } from '@icarus/core';
import { wireMetroIntoUnified } from './unified-fan-in.js';

/** Minimal metro stand-in: only `onLog` is used, and it lets the test fire lines. */
function makeFakeMetro(): {
  metro: Pick<MetroController, 'onLog'>;
  fire: (event: { stream: 'stdout' | 'stderr'; text: string; timestampMs: number }) => void;
  subscriberCount: () => number;
} {
  const handlers = new Set<
    (event: { stream: 'stdout' | 'stderr'; text: string; timestampMs: number }) => void
  >();
  return {
    metro: {
      onLog: (handler) => {
        handlers.add(handler as never);
        return () => handlers.delete(handler as never);
      },
    },
    fire: (event) => {
      for (const h of [...handlers]) h(event);
    },
    subscriberCount: () => handlers.size,
  };
}

describe('wireMetroIntoUnified', () => {
  it('forwards each Metro log line to unified.pushMetro with stream/text/timestamp', () => {
    const fake = makeFakeMetro();
    const pushMetro = vi.fn();
    const unified = { pushMetro } as unknown as Pick<UnifiedLogController, 'pushMetro'>;

    wireMetroIntoUnified(fake.metro, unified);
    fake.fire({ stream: 'stdout', text: 'Metro waiting', timestampMs: 111 });
    fake.fire({ stream: 'stderr', text: 'boom', timestampMs: 222 });

    expect(pushMetro).toHaveBeenNthCalledWith(1, 'stdout', 'Metro waiting', 111);
    expect(pushMetro).toHaveBeenNthCalledWith(2, 'stderr', 'boom', 222);
  });

  it('the returned unsubscribe detaches the wire', () => {
    const fake = makeFakeMetro();
    const pushMetro = vi.fn();
    const unified = { pushMetro } as unknown as Pick<UnifiedLogController, 'pushMetro'>;

    const off = wireMetroIntoUnified(fake.metro, unified);
    expect(fake.subscriberCount()).toBe(1);
    off();
    expect(fake.subscriberCount()).toBe(0);
    fake.fire({ stream: 'stdout', text: 'after', timestampMs: 333 });
    expect(pushMetro).not.toHaveBeenCalled();
  });
});
