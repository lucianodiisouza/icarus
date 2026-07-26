import type { FileStore } from '../persistence/file-store.js';
import { RingBuffer } from '../streaming/ring-buffer.js';
import type { LogEntrySource } from '../streaming/unified-log-stream.js';
import type { UnifiedLogEntry } from './unified-log.js';

/**
 * Persist the unified log to disk so a **crash** of Icarus is recoverable on the next launch
 * (TD-19, resolves OQ-9). Debug logs can carry secrets/PII (TR-5), and the ecosystem norm is
 * not to keep console history, so this is deliberately minimal and privacy-first:
 *
 *   - only a **bounded recent tail** is kept (never the whole session),
 *   - it lives **only on the user's machine** and is never transmitted (the E-12 boundary
 *     still gates any AI send), and
 *   - `clear()` (wired to a **clean exit**) removes the file, so a normal close leaves **no
 *     durable debug-log footprint** — recovery exists for the crash case, not as an archive.
 *
 * Writes are debounced (coalesced) so a high-rate stream is bounded I/O, not a write/entry.
 * Electron-free (ADR-0002): the `FileStore` and timers are injected.
 */

export interface UnifiedLogPersistenceOptions {
  /** Max entries retained on disk (the recent tail). */
  readonly capacity: number;
  /** Coalesce window: at most one write per this many ms of activity. */
  readonly debounceMs: number;
  /** Injected timers for deterministic tests (default to global timers). */
  readonly setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class UnifiedLogPersistence {
  readonly #source: LogEntrySource;
  readonly #store: FileStore;
  readonly #ring: RingBuffer<UnifiedLogEntry>;
  readonly #debounceMs: number;
  readonly #setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly #clearTimer: (handle: ReturnType<typeof setTimeout>) => void;

  #off: (() => void) | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #dirty = false;

  constructor(source: LogEntrySource, store: FileStore, options: UnifiedLogPersistenceOptions) {
    this.#source = source;
    this.#store = store;
    this.#ring = new RingBuffer<UnifiedLogEntry>(options.capacity);
    this.#debounceMs = options.debounceMs;
    this.#setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.#clearTimer = options.clearTimer ?? ((h) => clearTimeout(h));
  }

  /**
   * Load the persisted tail (whatever survived a crash; empty after a clean exit), seeding
   * the in-memory ring so subsequent writes preserve this history, and return it so the
   * caller can replay it into the UI. Tolerant of a missing/corrupt file (→ empty).
   */
  async load(): Promise<UnifiedLogEntry[]> {
    const raw = await this.#store.read();
    const entries = raw === null ? [] : deserialize(raw);
    for (const entry of entries) this.#ring.push(entry);
    return entries;
  }

  /** Begin capturing live entries. Call after `load()` so the ring keeps prior history. */
  start(): void {
    if (this.#off !== null) return;
    this.#off = this.#source.onEntry((entry) => {
      this.#ring.push(entry);
      this.#scheduleWrite();
    });
  }

  /** Force any pending write to happen now (tests; not needed on a clean exit, which clears). */
  async flush(): Promise<void> {
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer);
      this.#timer = null;
    }
    if (this.#dirty) await this.#writeNow();
  }

  /** Remove the persisted artifact — wired to a clean exit so no debug logs linger on disk. */
  async clear(): Promise<void> {
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer);
      this.#timer = null;
    }
    this.#dirty = false;
    this.#ring.clear();
    await this.#store.clear();
  }

  /** Detach from the source and cancel any pending write. Idempotent. */
  dispose(): void {
    this.#off?.();
    this.#off = null;
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer);
      this.#timer = null;
    }
  }

  #scheduleWrite(): void {
    this.#dirty = true;
    if (this.#timer !== null) return; // a write is already scheduled within this window
    this.#timer = this.#setTimer(() => {
      this.#timer = null;
      void this.#writeNow();
    }, this.#debounceMs);
  }

  async #writeNow(): Promise<void> {
    this.#dirty = false;
    await this.#store.write(serialize(this.#ring.snapshot()));
  }
}

function serialize(entries: readonly UnifiedLogEntry[]): string {
  return JSON.stringify(entries);
}

function deserialize(raw: string): UnifiedLogEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isUnifiedLogEntry) : [];
  } catch {
    return [];
  }
}

function isUnifiedLogEntry(value: unknown): value is UnifiedLogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['source'] === 'string' &&
    typeof entry['level'] === 'string' &&
    typeof entry['text'] === 'string' &&
    typeof entry['timestampMs'] === 'number'
  );
}
