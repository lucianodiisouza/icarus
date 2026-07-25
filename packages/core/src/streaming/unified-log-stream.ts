import type { UnifiedLogEntry } from '../unified-log/unified-log.js';
import { RingBuffer } from './ring-buffer.js';
import { StreamBatcher, type StreamBatcherOptions } from './stream-batcher.js';

/**
 * The subscription delta for the unified log (E-03s, resolves OQ-13). The log is
 * an **append-only** stream, so the only mutation a subscriber ever sees is "these
 * entries were appended". A JSON-patch / structural-diff representation would be
 * strictly more machinery for zero gain here — the domain delta is this one shape:
 */
export interface UnifiedLogDelta {
  readonly appended: readonly UnifiedLogEntry[];
}

/** The minimal source the stream reads from (the UnifiedLogController satisfies it). */
export interface LogEntrySource {
  onEntry(handler: (entry: UnifiedLogEntry) => void): () => void;
}

export interface UnifiedLogStreamOptions {
  /** How many recent entries the snapshot retains (bounds late-subscriber payload). */
  readonly snapshotCapacity: number;
  /** Batching window in ms (see StreamBatcher — bounds the renderer update rate). */
  readonly windowMs: number;
  /** Max entries per delta before an early flush (bounds memory under load). */
  readonly maxBatch: number;
  /** Injected timers for deterministic tests. */
  readonly setTimer?: StreamBatcherOptions<UnifiedLogEntry>['setTimer'];
  readonly clearTimer?: StreamBatcherOptions<UnifiedLogEntry>['clearTimer'];
}

/**
 * The renderer-facing view of the unified log as a **snapshot + batched deltas**
 * subscription (ADR-0006, E-03s). This is the TR-6 mitigation made concrete: it
 * subscribes to the controller's per-entry fan-out ONCE, keeps a bounded ring for
 * the snapshot, and coalesces new entries through a per-subscriber `StreamBatcher`
 * so a 10k-line/second burst becomes a handful of batched deltas, not 10k IPC
 * messages and 10k React renders.
 *
 * Multiple subscribers are supported (each gets its own batcher/cadence) so a
 * reopened window resubscribes cleanly. Electron-free — the desktop shell wires
 * `subscribe`'s callback to `webContents.send`.
 */
export class UnifiedLogStream {
  readonly #ring: RingBuffer<UnifiedLogEntry>;
  readonly #subscribers = new Set<StreamBatcher<UnifiedLogEntry>>();
  readonly #options: UnifiedLogStreamOptions;
  readonly #off: () => void;
  #disposed = false;

  constructor(source: LogEntrySource, options: UnifiedLogStreamOptions) {
    this.#options = options;
    this.#ring = new RingBuffer<UnifiedLogEntry>(options.snapshotCapacity);
    // Subscribe to the source exactly once; fan each entry to the snapshot ring
    // and every active subscriber's batcher.
    this.#off = source.onEntry((entry) => {
      this.#ring.push(entry);
      for (const batcher of this.#subscribers) batcher.push(entry);
    });
  }

  /** The current recent-history snapshot (oldest→newest), for a new subscriber. */
  snapshot(): UnifiedLogEntry[] {
    return this.#ring.snapshot();
  }

  /**
   * Start receiving batched append-deltas. Returns an unsubscribe that flushes
   * any buffered entries (no data loss on unsubscribe) and detaches the batcher.
   */
  subscribe(onDelta: (delta: UnifiedLogDelta) => void): () => void {
    const batcher = new StreamBatcher<UnifiedLogEntry>({
      maxBatch: this.#options.maxBatch,
      windowMs: this.#options.windowMs,
      onFlush: (batch) => onDelta({ appended: batch }),
      ...(this.#options.setTimer ? { setTimer: this.#options.setTimer } : {}),
      ...(this.#options.clearTimer ? { clearTimer: this.#options.clearTimer } : {}),
    });
    this.#subscribers.add(batcher);
    return () => {
      this.#subscribers.delete(batcher);
      batcher.dispose();
    };
  }

  /** Number of active subscribers (for tests/diagnostics). */
  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  /** Detach from the source and dispose every subscriber. Idempotent. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#off();
    for (const batcher of this.#subscribers) batcher.dispose();
    this.#subscribers.clear();
  }
}
