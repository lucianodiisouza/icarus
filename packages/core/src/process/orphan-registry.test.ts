import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FileOrphanRegistry,
  reapOrphans,
  type OrphanRecord,
  type ProcessIdentityProbe,
  type RegistryStore,
} from './orphan-registry.js';

/** A probe backed by a pid→marker map; a missing pid means "not alive" (null). */
function fakeProbe(alive: Record<number, string>): ProcessIdentityProbe {
  return { identify: (pid) => Promise.resolve(alive[pid] ?? null) };
}

/** An in-memory RegistryStore whose latest written content is readable via `.data`. */
function memoryStore(initial: string | null = null): RegistryStore & { data: string | null } {
  const store = {
    data: initial,
    read(): Promise<string | null> {
      return Promise.resolve(store.data);
    },
    write(d: string): Promise<void> {
      store.data = d;
      return Promise.resolve();
    },
  };
  return store;
}

const record = (over: Partial<OrphanRecord> = {}): OrphanRecord => {
  const base = { pid: 100, command: 'metro', marker: 'Sat Jul 26 10:00:00 2026' };
  // For a POSIX detached spawn pgid === pid, so default it from pid unless overridden.
  return { ...base, pgid: over.pid ?? base.pid, ...over };
};

describe('reapOrphans', () => {
  it('kills a survivor whose identity marker still matches', async () => {
    const kill = vi.fn();
    const rec = record({ pid: 100, pgid: 100, marker: 'M1' });
    const report = await reapOrphans([rec], fakeProbe({ 100: 'M1' }), kill);

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(100);
    expect(report.reaped).toEqual([100]);
    expect(report.recycled).toEqual([]);
    expect(report.dead).toEqual([]);
  });

  it('does NOT kill a recycled pid (marker changed)', async () => {
    const kill = vi.fn();
    const rec = record({ pid: 100, marker: 'ORIGINAL' });
    const report = await reapOrphans([rec], fakeProbe({ 100: 'A_DIFFERENT_PROCESS' }), kill);

    expect(kill).not.toHaveBeenCalled();
    expect(report.recycled).toEqual([100]);
    expect(report.reaped).toEqual([]);
  });

  it('skips a pid that is already gone', async () => {
    const kill = vi.fn();
    const report = await reapOrphans([record({ pid: 100 })], fakeProbe({}), kill);

    expect(kill).not.toHaveBeenCalled();
    expect(report.dead).toEqual([100]);
  });

  it('never kills a record with no captured marker (unverifiable)', async () => {
    const kill = vi.fn();
    // Even if a live process sits on that pid, an unmarked record is not provably ours.
    const report = await reapOrphans(
      [record({ pid: 100, marker: null })],
      fakeProbe({ 100: 'X' }),
      kill,
    );

    expect(kill).not.toHaveBeenCalled();
    expect(report.unverifiable).toEqual([100]);
  });

  it('reaps the group leader by pgid, not by pid', async () => {
    const kill = vi.fn();
    await reapOrphans(
      [record({ pid: 4242, pgid: 4242, marker: 'M' })],
      fakeProbe({ 4242: 'M' }),
      kill,
    );
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(4242);
  });

  it('classifies a mixed batch correctly', async () => {
    const kill = vi.fn();
    const records = [
      record({ pid: 1, marker: 'a' }), // matches → reap
      record({ pid: 2, marker: 'b' }), // recycled
      record({ pid: 3, marker: 'c' }), // dead
      record({ pid: 4, marker: null }), // unverifiable
    ];
    const report = await reapOrphans(records, fakeProbe({ 1: 'a', 2: 'CHANGED' }), kill);

    expect(report).toEqual({ reaped: [1], recycled: [2], dead: [3], unverifiable: [4] });
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(1);
  });
});

describe('FileOrphanRegistry', () => {
  let store: RegistryStore & { data: string | null };

  beforeEach(() => {
    store = memoryStore();
  });

  it('persists a spawn and captures its identity marker asynchronously', async () => {
    const registry = new FileOrphanRegistry(store, fakeProbe({ 100: 'MARKER-100' }));
    registry.onSpawn({ pid: 100, pgid: 100, command: 'metro' });

    // Synchronously tracked, marker not yet captured.
    expect(registry.records()).toEqual([{ pid: 100, pgid: 100, command: 'metro', marker: null }]);

    await registry.whenFlushed();

    expect(registry.records()[0]?.marker).toBe('MARKER-100');
    expect(JSON.parse(store.data!)).toEqual([
      { pid: 100, pgid: 100, command: 'metro', marker: 'MARKER-100' },
    ]);
  });

  it('forgets a process on clean exit and re-persists', async () => {
    const registry = new FileOrphanRegistry(store, fakeProbe({ 100: 'm', 200: 'n' }));
    registry.onSpawn({ pid: 100, pgid: 100, command: 'a' });
    registry.onSpawn({ pid: 200, pgid: 200, command: 'b' });
    await registry.whenFlushed();

    registry.onExit(100);
    await registry.whenFlushed();

    expect(registry.records().map((r) => r.pid)).toEqual([200]);
    expect(JSON.parse(store.data!).map((r: OrphanRecord) => r.pid)).toEqual([200]);
  });

  it('reap() reaps survivors from the previous run, then clears the store', async () => {
    const previous: OrphanRecord[] = [
      { pid: 100, pgid: 100, command: 'metro', marker: 'STILL-ALIVE' },
      { pid: 200, pgid: 200, command: 'sim', marker: 'ORIGINAL' },
    ];
    store = memoryStore(JSON.stringify(previous));
    const registry = new FileOrphanRegistry(
      store,
      fakeProbe({ 100: 'STILL-ALIVE', 200: 'RECYCLED' }),
    );
    const kill = vi.fn();

    const report = await registry.reap(kill);

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(100);
    expect(report.reaped).toEqual([100]);
    expect(report.recycled).toEqual([200]);
    // Store is cleared so this run starts clean.
    expect(JSON.parse(store.data!)).toEqual([]);
    expect(registry.records()).toEqual([]);
  });

  it('reap() on a fresh install (no store file) is a no-op', async () => {
    const registry = new FileOrphanRegistry(memoryStore(null), fakeProbe({}));
    const kill = vi.fn();

    const report = await registry.reap(kill);

    expect(report).toEqual({ reaped: [], recycled: [], dead: [], unverifiable: [] });
    expect(kill).not.toHaveBeenCalled();
  });

  it('tolerates a corrupt store file (reads as empty)', async () => {
    const registry = new FileOrphanRegistry(memoryStore('{not json'), fakeProbe({}));
    const report = await registry.reap(vi.fn());
    expect(report.reaped).toEqual([]);
  });
});
