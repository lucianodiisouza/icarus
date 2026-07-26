import type { CdpConsoleEntry } from '../protocol/cdp/console.js';
import { fuseCdp, fuseMetro, fuseNative } from './unified-log-fuser.js';
import type { UnifiedLogEntry } from './unified-log.js';

/**
 * Subscribable sink for the unified log stream (E-10). Anything that wants
 * to receive unified entries calls \`onEntry\`. The CdpSession / MetroController
 * / native source fan-in to this in main, and the renderer subscribes via
 * IPC to the same stream — single source of truth for "what just happened in
 * the app".
 */
export type UnifiedEntryHandler = (entry: UnifiedLogEntry) => void;

export class UnifiedLogController {
  readonly #handlers = new Set<UnifiedEntryHandler>();
  #disposers: Array<() => void> = [];

  /** Subscribe to the unified stream. Returns an unsubscribe function. */
  onEntry(handler: UnifiedEntryHandler): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  /** Stop the controller and detach all upstream subscriptions. */
  dispose(): void {
    for (const off of this.#disposers) off();
    this.#disposers = [];
    this.#handlers.clear();
  }

  /**
   * Forward a CDP console event into the unified stream. Returns the
   * (already-fused) entry so callers can attach a UI hint if they want.
   */
  pushCdp(entry: CdpConsoleEntry): UnifiedLogEntry {
    return this.#emit(fuseCdp(entry));
  }

  /** Forward a Metro stdout/stderr line. */
  pushMetro(stream: 'stdout' | 'stderr', text: string, timestampMs?: number): UnifiedLogEntry {
    return this.#emit(
      fuseMetro({ stream, text, timestampMs: timestampMs ?? Date.now() }, Date.now),
    );
  }

  /** Forward a native log line; null if the line can't be normalized. */
  pushNative(line: string): UnifiedLogEntry | null {
    const entry = fuseNative(line, Date.now);
    if (entry === null) return null;
    return this.#emit(entry);
  }

  /**
   * Re-emit already-fused entries (e.g. a persisted tail restored after a crash, TD-19).
   * Unlike the `push*` methods these are not re-fused or re-timestamped — they flow through
   * the stream exactly as captured, so a reopened window's snapshot shows prior history.
   */
  replay(entries: readonly UnifiedLogEntry[]): void {
    for (const entry of entries) this.#emit(entry);
  }

  #emit(entry: UnifiedLogEntry): UnifiedLogEntry {
    for (const h of [...this.#handlers]) h(entry);
    return entry;
  }
}
