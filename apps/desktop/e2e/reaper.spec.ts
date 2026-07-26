import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_ENTRY = join(__dirname, '..', 'out', 'main', 'index.js');
const STORE_FILENAME = 'orphaned-processes.json';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(fn: () => boolean, timeoutMs = 5000, stepMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return fn();
}

/** Spawn a detached, long-lived process (its own group; pgid === pid) — a stand-in orphan. */
function spawnOrphan(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid!;
}

/**
 * Cross-launch orphan reaper, proven in the *assembled* app (TD-11). The unit tests cover
 * the reap logic and the real `ps`/kill adapters; this proves the packaged Main actually
 * runs the reap at startup and kills a survivor a previous hard crash would have left.
 *
 * The reaper is `await`ed before the first window is created, so `firstWindow()` resolving
 * is a clean happens-after: by then, the reap has run.
 */
test.describe('cross-launch orphan reaper (TD-11)', () => {
  let userDataDir: string;
  let orphanPid: number | undefined;

  test.afterEach(async () => {
    // Never leak the stand-in orphan, even if an assertion failed before it was reaped.
    if (orphanPid !== undefined && isAlive(orphanPid)) {
      try {
        process.kill(-orphanPid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    orphanPid = undefined;
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
  });

  test('reaps a real orphan left by a previous run and clears the store', async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'icarus-e2e-reaper-'));
    const args = [MAIN_ENTRY, `--user-data-dir=${userDataDir}`];

    // Launch once to learn where this app instance persists the reaper file, then close.
    const first = await electron.launch({ args });
    const userData: string = await first.evaluate(({ app }) => app.getPath('userData'));
    await first.close();
    const storeFile = join(userData, STORE_FILENAME);

    // Spawn a real orphan and record it exactly as a hard-crashed run would have: pid +
    // the same `ps -o lstart=` identity marker the reaper re-reads to confirm it's ours.
    orphanPid = spawnOrphan();
    expect(await waitUntil(() => isAlive(orphanPid!))).toBe(true);
    const marker = execFileSync('ps', ['-o', 'lstart=', '-p', String(orphanPid)])
      .toString()
      .trim();
    await writeFile(
      storeFile,
      JSON.stringify([{ pid: orphanPid, pgid: orphanPid, command: 'node', marker }]),
    );

    // Relaunch: the startup reap should find the survivor, confirm identity, and kill it.
    const second = await electron.launch({ args });
    await second.firstWindow(); // reap has completed by the time a window exists
    try {
      expect(await waitUntil(() => !isAlive(orphanPid!))).toBe(true);
      // The store is cleared so this run starts clean.
      const cleared: unknown = JSON.parse(await readFile(storeFile, 'utf8'));
      expect(cleared).toEqual([]);
    } finally {
      await second.close();
    }
  });

  test('spares a process whose identity marker no longer matches (PID recycling)', async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'icarus-e2e-reaper-'));
    const args = [MAIN_ENTRY, `--user-data-dir=${userDataDir}`];

    const first = await electron.launch({ args });
    const userData: string = await first.evaluate(({ app }) => app.getPath('userData'));
    await first.close();
    const storeFile = join(userData, STORE_FILENAME);

    // A live process, but recorded with a STALE marker — models a pid reused by an
    // unrelated process after our crash. The reaper must NOT kill it.
    orphanPid = spawnOrphan();
    expect(await waitUntil(() => isAlive(orphanPid!))).toBe(true);
    await writeFile(
      storeFile,
      JSON.stringify([
        {
          pid: orphanPid,
          pgid: orphanPid,
          command: 'node',
          marker: 'STALE-MARKER-FROM-A-DEAD-PROC',
        },
      ]),
    );

    const second = await electron.launch({ args });
    await second.firstWindow();
    try {
      // Give the reaper the same window it would have had to (wrongly) kill it.
      await new Promise((r) => setTimeout(r, 500));
      expect(isAlive(orphanPid!)).toBe(true); // spared — not provably ours
    } finally {
      await second.close();
    }
  });
});
