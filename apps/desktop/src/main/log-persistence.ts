import { join } from 'node:path';
import {
  fileStore,
  UnifiedLogController,
  UnifiedLogPersistence,
  type LogEntrySource,
} from '@icarus/core';

const STORE_FILENAME = 'unified-log.json';
/** Recent tail kept on disk — matches the renderer snapshot capacity so a restore fills it. */
const CAPACITY = 2000;
/** Coalesce disk writes; a crash loses at most this window of the newest lines. */
const DEBOUNCE_MS = 1000;

/**
 * Unified-log disk persistence (TD-19, resolves OQ-9). Keeps a bounded recent tail under
 * `userData` so a **crash** of Icarus is recoverable on the next launch, and clears it on a
 * clean exit so a normal close leaves no durable debug-log footprint. Local-only — this file
 * is never transmitted; the E-12 boundary still gates any AI send. See ADR-0012.
 */
export function createUnifiedLogPersistence(
  userDataDir: string,
  source: LogEntrySource,
): UnifiedLogPersistence {
  return new UnifiedLogPersistence(source, fileStore(join(userDataDir, STORE_FILENAME)), {
    capacity: CAPACITY,
    debounceMs: DEBOUNCE_MS,
  });
}

/**
 * Restore any tail a previous crash left behind into the live log (so a reopened window shows
 * it), then begin capturing new entries. Best-effort: a missing/corrupt file restores nothing.
 * Call once at startup, before the first window is created.
 */
export async function restoreUnifiedLog(
  persistence: UnifiedLogPersistence,
  controller: UnifiedLogController,
): Promise<void> {
  const restored = await persistence.load();
  controller.replay(restored);
  persistence.start();
}
