import { join } from 'node:path';
import {
  FileOrphanRegistry,
  fileRegistryStore,
  killProcessGroup,
  psIdentityProbe,
} from '@icarus/core';

const REGISTRY_FILENAME = 'orphaned-processes.json';

/**
 * Cross-launch orphan registry (TD-11). `ProcessManager.disposeAll()` on `will-quit` covers
 * a clean exit, but a hard crash of Icarus (SIGKILL, power loss) can't run cleanup — its
 * detached child groups (Metro + workers, simulators) then survive. This registry persists
 * every spawned group under `userData` so the survivors can be reaped on the next launch.
 */
export function createOrphanRegistry(userDataDir: string): FileOrphanRegistry {
  return new FileOrphanRegistry(
    fileRegistryStore(join(userDataDir, REGISTRY_FILENAME)),
    psIdentityProbe,
  );
}

/**
 * Reap process groups orphaned by a previous hard crash, then start clean. Must run before
 * any spawn this session, so a survivor is never confused with a group we start now. PID
 * reuse is guarded inside `reap` by a start-time identity marker — a survivor is killed only
 * when it is provably still ours. A fresh install has no registry file and this is a no-op;
 * reaping is best-effort hardening and never blocks startup.
 */
export async function reapOrphansFromPreviousRun(registry: FileOrphanRegistry): Promise<void> {
  try {
    const report = await registry.reap(killProcessGroup);
    if (report.reaped.length > 0) {
      console.warn(
        `[reaper] killed ${report.reaped.length} orphaned process group(s) from a previous run`,
        report,
      );
    }
  } catch (err) {
    console.warn('[reaper] orphan reap failed (continuing)', err);
  }
}
