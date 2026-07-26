import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { KillGroup, ProcessIdentityProbe, RegistryStore } from './orphan-registry.js';

const execFileAsync = promisify(execFile);

/**
 * Production wiring for the orphan reaper (POSIX-first, NG-7). The identity marker is the
 * process's OS start time from `ps -o lstart=`, which is stable for the life of a process
 * and changes when a pid is recycled — exactly the discriminator the reaper needs.
 */

/** Identity probe backed by `ps`. Returns `null` when the pid is not alive (ps fails). */
export const psIdentityProbe: ProcessIdentityProbe = {
  async identify(pid: number): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('ps', ['-o', 'lstart=', '-p', String(pid)]);
      const marker = stdout.trim();
      return marker.length > 0 ? marker : null;
    } catch {
      return null; // ps exits non-zero when the pid doesn't exist
    }
  },
};

/** Force-kill a whole process group (negative pid). Best-effort; a dead group is a no-op. */
export const killProcessGroup: KillGroup = (pgid: number): void => {
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    /* group already gone */
  }
};

/** File-backed `RegistryStore`; a missing file reads as an empty set. */
export function fileRegistryStore(path: string): RegistryStore {
  return {
    async read(): Promise<string | null> {
      try {
        return await readFile(path, 'utf8');
      } catch (err) {
        if (isEnoent(err)) return null;
        throw err;
      }
    },
    async write(data: string): Promise<void> {
      await writeFile(path, data, 'utf8');
    },
  };
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
