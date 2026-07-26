import { readFile, rm, writeFile } from 'node:fs/promises';

/**
 * A tiny read/write/clear text store — the seam every on-disk persistence feature writes
 * through, so the domain logic that uses it stays pure and unit-testable with an in-memory
 * fake (mirrors the reaper's injected store, TD-11). Electron-free (ADR-0002).
 */
export interface FileStore {
  /** The persisted text, or `null` if nothing has been written yet. */
  read(): Promise<string | null>;
  write(data: string): Promise<void>;
  /** Remove the backing artifact entirely (used to leave no footprint on clean exit). */
  clear(): Promise<void>;
}

/** File-backed `FileStore`; a missing file reads as `null` and clears as a no-op. */
export function fileStore(path: string): FileStore {
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
    async clear(): Promise<void> {
      await rm(path, { force: true });
    },
  };
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
