import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ProcessManager } from './process-manager.js';

const FIXTURE = fileURLToPath(new URL('./__fixtures__/long-lived.mjs', import.meta.url));
const NODE = process.execPath;

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

describe('ProcessManager / ManagedProcess', () => {
  let manager: ProcessManager;

  afterEach(async () => {
    // Never leak fixtures out of a test, even on failure.
    await manager.disposeAll();
  });

  it('spawns, reaches ready via readyWhen, and captures output', { timeout: 15000 }, async () => {
    manager = new ProcessManager();
    const proc = manager.spawn({
      command: NODE,
      args: [FIXTURE, '--ready-after-ms=100'],
      readyWhen: (line) => line.includes('READY'),
    });

    await proc.waitReady();

    expect(proc.state).toBe('ready');
    expect(proc.pid).toBeGreaterThan(0);
    expect(await waitUntil(() => proc.stdout.lines().some((l) => l.startsWith('tick')))).toBe(true);
    expect(manager.list()).toHaveLength(1);
  });

  it('stop() terminates the process and reports exit info', { timeout: 15000 }, async () => {
    manager = new ProcessManager();
    const proc = manager.spawn({ command: NODE, args: [FIXTURE] });
    await proc.waitReady();
    const pid = proc.pid!;

    const info = await proc.stop();

    expect(info.signal ?? info.code).toBeDefined();
    expect(proc.state).toBe('exited');
    expect(await waitUntil(() => !isAlive(pid))).toBe(true);
    // Exited processes are removed from the registry.
    expect(manager.get(proc.id)).toBeUndefined();
  });

  it(
    'stop() kills the whole process group — grandchildren die too (TR-2)',
    { timeout: 15000 },
    async () => {
      manager = new ProcessManager();
      let grandchildPid = 0;
      const proc = manager.spawn({
        command: NODE,
        args: [FIXTURE, '--fork-child'],
        readyWhen: (line) => line.includes('READY'),
      });
      proc.onLine(({ text }) => {
        const match = /GRANDCHILD (\d+)/.exec(text);
        if (match) grandchildPid = Number(match[1]);
      });

      await proc.waitReady();
      expect(await waitUntil(() => grandchildPid > 0)).toBe(true);
      expect(isAlive(grandchildPid)).toBe(true);

      await proc.stop();

      // The grandchild must not be orphaned.
      expect(await waitUntil(() => !isAlive(grandchildPid))).toBe(true);
    },
  );

  it('escalates to SIGKILL when the process ignores SIGTERM', { timeout: 15000 }, async () => {
    manager = new ProcessManager();
    const proc = manager.spawn({
      command: NODE,
      args: [FIXTURE, '--ignore-sigterm'],
      readyWhen: (line) => line.includes('READY'),
      shutdown: { graceMs: 300 },
    });
    await proc.waitReady();
    const pid = proc.pid!;

    const info = await proc.stop();

    expect(info.forced).toBe(true);
    expect(await waitUntil(() => !isAlive(pid))).toBe(true);
  });

  it('rejects duplicate ids', () => {
    manager = new ProcessManager();
    manager.spawn({ id: 'dup', command: NODE, args: [FIXTURE] });
    expect(() => manager.spawn({ id: 'dup', command: NODE, args: [FIXTURE] })).toThrow(/already/);
  });

  it('disposeAll leaves zero orphans across a batch (soak)', { timeout: 30000 }, async () => {
    manager = new ProcessManager();
    const N = 25;
    const pids: number[] = [];
    const grandchildPids: number[] = [];

    const procs = Array.from({ length: N }, () => {
      const p = manager.spawn({
        command: NODE,
        args: [FIXTURE, '--fork-child'],
        readyWhen: (line) => line.includes('READY'),
      });
      p.onLine(({ text }) => {
        const m = /GRANDCHILD (\d+)/.exec(text);
        if (m) grandchildPids.push(Number(m[1]));
      });
      return p;
    });

    await Promise.all(procs.map((p) => p.waitReady()));
    for (const p of procs) pids.push(p.pid!);
    expect(await waitUntil(() => grandchildPids.length === N)).toBe(true);

    await manager.disposeAll();

    const all = [...pids, ...grandchildPids];
    const survivors = await waitUntil(() => all.every((pid) => !isAlive(pid)), 5000).then(() =>
      all.filter((pid) => isAlive(pid)),
    );
    expect(survivors).toEqual([]);
    expect(manager.list()).toHaveLength(0);
  });
});
