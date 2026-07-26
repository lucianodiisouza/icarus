import { describe, expect, it } from 'vitest';
import { UnifiedLogController } from './unified-log-controller.js';
import { UnifiedLogPersistence } from './log-persistence.js';

/** In-memory FileStore that also counts writes/clears. */
function memoryStore(initial: string | null = null) {
  const store = {
    data: initial,
    writes: 0,
    clears: 0,
    read: (): Promise<string | null> => Promise.resolve(store.data),
    write: (d: string): Promise<void> => {
      store.data = d;
      store.writes++;
      return Promise.resolve();
    },
    clear: (): Promise<void> => {
      store.data = null;
      store.clears++;
      return Promise.resolve();
    },
  };
  return store;
}

/** A manually-driven timer so debounce behavior is deterministic. */
function manualTimer() {
  let pending: (() => void) | null = null;
  return {
    setTimer: ((fn: () => void) => {
      pending = fn;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as UnifiedLogPersistenceOptionsTimer,
    clearTimer: (() => {
      pending = null;
    }) as (h: ReturnType<typeof setTimeout>) => void,
    get scheduled(): boolean {
      return pending !== null;
    },
    fire(): void {
      const fn = pending;
      pending = null;
      fn?.();
    },
  };
}
type UnifiedLogPersistenceOptionsTimer = (
  fn: () => void,
  ms: number,
) => ReturnType<typeof setTimeout>;

const OPTS = { capacity: 3, debounceMs: 50 };

function makeEntry(text: string, timestampMs = 1) {
  return { source: 'cdp' as const, level: 'log' as const, text, timestampMs };
}

describe('UnifiedLogPersistence', () => {
  it('captures entries and writes the snapshot to disk on flush', async () => {
    const controller = new UnifiedLogController();
    const store = memoryStore();
    const persistence = new UnifiedLogPersistence(controller, store, OPTS);
    persistence.start();

    controller.pushCdp({ level: 'error', text: 'boom', timestampMs: 1000 });
    await persistence.flush();

    const persisted = JSON.parse(store.data!) as Array<{ text: string; source: string }>;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ text: 'boom', source: 'cdp' });
  });

  it('coalesces a burst into a single debounced write', async () => {
    const controller = new UnifiedLogController();
    const store = memoryStore();
    const timer = manualTimer();
    const persistence = new UnifiedLogPersistence(controller, store, {
      ...OPTS,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });
    persistence.start();

    controller.pushMetro('stdout', 'a', 1);
    controller.pushMetro('stdout', 'b', 2);
    controller.pushMetro('stdout', 'c', 3);

    // Nothing written yet — the three pushes share one debounce window.
    expect(store.writes).toBe(0);
    expect(timer.scheduled).toBe(true);

    timer.fire();
    await Promise.resolve(); // let the async write settle

    expect(store.writes).toBe(1);
    const persisted = JSON.parse(store.data!) as unknown[];
    expect(persisted).toHaveLength(3);
  });

  it('retains only the most recent `capacity` entries (bounded tail)', async () => {
    const controller = new UnifiedLogController();
    const store = memoryStore();
    const persistence = new UnifiedLogPersistence(controller, store, OPTS); // capacity 3
    persistence.start();

    for (const text of ['1', '2', '3', '4', '5']) controller.pushMetro('stdout', text, 0);
    await persistence.flush();

    const persisted = JSON.parse(store.data!) as Array<{ text: string }>;
    expect(persisted.map((e) => e.text)).toEqual(['3', '4', '5']);
  });

  it('load() returns the persisted tail and seeds the ring so history is preserved', async () => {
    const seeded = [makeEntry('old-1'), makeEntry('old-2')];
    const store = memoryStore(JSON.stringify(seeded));
    const controller = new UnifiedLogController();
    const persistence = new UnifiedLogPersistence(controller, store, OPTS);

    const loaded = await persistence.load();
    expect(loaded.map((e) => e.text)).toEqual(['old-1', 'old-2']);

    // A new live entry must be persisted alongside the restored history, not replace it.
    persistence.start();
    controller.pushMetro('stdout', 'new-1', 9);
    await persistence.flush();

    const persisted = JSON.parse(store.data!) as Array<{ text: string }>;
    // capacity 3, exactly 3 entries → history retained alongside the new one.
    expect(persisted.map((e) => e.text)).toEqual(['old-1', 'old-2', 'new-1']);
  });

  it('load() tolerates a missing or corrupt file (→ empty)', async () => {
    const controller = new UnifiedLogController();
    expect(await new UnifiedLogPersistence(controller, memoryStore(null), OPTS).load()).toEqual([]);
    expect(
      await new UnifiedLogPersistence(controller, memoryStore('{not json'), OPTS).load(),
    ).toEqual([]);
  });

  it('clear() removes the file and cancels any pending write (clean-exit path)', async () => {
    const controller = new UnifiedLogController();
    const store = memoryStore();
    const timer = manualTimer();
    const persistence = new UnifiedLogPersistence(controller, store, {
      ...OPTS,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });
    persistence.start();
    controller.pushMetro('stdout', 'secret-token', 1);
    expect(timer.scheduled).toBe(true);

    await persistence.clear();

    expect(store.clears).toBe(1);
    expect(store.data).toBeNull();
    expect(timer.scheduled).toBe(false); // pending write cancelled — no leftover on disk
  });

  it('dispose() stops capturing further entries', async () => {
    const controller = new UnifiedLogController();
    const store = memoryStore();
    const persistence = new UnifiedLogPersistence(controller, store, OPTS);
    persistence.start();
    persistence.dispose();

    controller.pushMetro('stdout', 'after-dispose', 1);
    await persistence.flush();

    expect(store.writes).toBe(0); // nothing captured after dispose
  });
});
