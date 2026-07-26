import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { reapOrphans, type OrphanRecord } from './orphan-registry.js';
import { fileRegistryStore, killProcessGroup, psIdentityProbe } from './os-process-probe.js';

const FIXTURE = fileURLToPath(new URL('./__fixtures__/long-lived.mjs', import.meta.url));

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(fn: () => boolean, timeoutMs = 3000, stepMs = 25): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return fn();
}

/**
 * End-to-end proof the reaper works against the real OS: `psIdentityProbe` reads a live
 * process's start time, and `killProcessGroup` tears down a detached group — the exact
 * pieces the cross-launch reaper wires together (TD-11).
 */
describe('os-process-probe (real processes)', () => {
  const survivors: number[] = [];

  afterEach(() => {
    // Never leak a fixture, even if an assertion failed mid-test.
    for (const pid of survivors) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    }
    survivors.length = 0;
  });

  it('identifies a live pid and returns null once it is gone', async () => {
    const child = spawn(process.execPath, [FIXTURE], { detached: true, stdio: 'ignore' });
    const pid = child.pid!;
    survivors.push(pid);

    const marker = await psIdentityProbe.identify(pid);
    expect(marker).toBeTruthy();
    // Stable across reads (this is what makes it a reliable identity).
    expect(await psIdentityProbe.identify(pid)).toBe(marker);

    process.kill(-pid, 'SIGKILL');
    survivors.length = 0;
    expect(await waitUntil(() => !isAlive(pid))).toBe(true);
    expect(await psIdentityProbe.identify(pid)).toBeNull();
  });

  it('reaps a real orphan whose marker still matches, and spares a mismatched one', async () => {
    // Simulate two "survivors from a previous run": one real, one whose marker we corrupt.
    const real = spawn(process.execPath, [FIXTURE], { detached: true, stdio: 'ignore' });
    const spared = spawn(process.execPath, [FIXTURE], { detached: true, stdio: 'ignore' });
    const realPid = real.pid!;
    const sparedPid = spared.pid!;
    survivors.push(realPid, sparedPid);

    const realMarker = await psIdentityProbe.identify(realPid);
    const records: OrphanRecord[] = [
      { pid: realPid, pgid: realPid, command: 'node', marker: realMarker },
      // A stale record whose marker won't match the live process (models pid recycling).
      { pid: sparedPid, pgid: sparedPid, command: 'node', marker: 'STALE-MARKER-FROM-A-DEAD-PROC' },
    ];

    const report = await reapOrphans(records, psIdentityProbe, killProcessGroup);

    expect(report.reaped).toEqual([realPid]);
    expect(report.recycled).toEqual([sparedPid]);
    expect(await waitUntil(() => !isAlive(realPid))).toBe(true);
    // The mismatched one was correctly spared (would be a bug to kill someone else's pid).
    expect(isAlive(sparedPid)).toBe(true);
  });
});

describe('fileRegistryStore', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('reads null before anything is written, then round-trips', async () => {
    dir = await mkdtemp(join(tmpdir(), 'icarus-reaper-'));
    const store = fileRegistryStore(join(dir, 'orphans.json'));

    expect(await store.read()).toBeNull(); // missing file → empty set (fresh install)

    await store.write('[{"pid":1}]');
    expect(await store.read()).toBe('[{"pid":1}]');
  });
});
