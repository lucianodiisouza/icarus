/**
 * Time-windowed batching with a bounded buffer (E-03s, ADR-0006). The mitigation
 * for TR-6: a high-rate producer (logs, network) must not translate into a
 * high-rate consumer (one IPC message + one React render per item = jank).
 *
 * `StreamBatcher` coalesces pushed items and flushes them as one batch:
 *   - **time window** — the first item in an empty buffer schedules a flush
 *     `windowMs` later. This bounds the *flush rate* to ≤ 1 per `windowMs`
 *     regardless of input rate — the property that keeps the UI responsive.
 *   - **count cap** — if the buffer reaches `maxBatch` before the window
 *     elapses, it flushes immediately. This bounds buffer memory and batch
 *     size under pathological load (backpressure): the flush rate may rise
 *     above 1/`windowMs`, but memory never grows unbounded.
 *
 * No item is ever dropped — backpressure trades latency/IPC-count for memory,
 * never data loss. That's the right call for logs (a dropped line is a lie).
 *
 * Electron-free and timer-injected, so it is unit-testable with fake timers
 * (see the load test) without a shell (ADR-0002).
 */
export interface StreamBatcherOptions<T> {
  /**
   * Max items to hold before forcing an early flush. Bounds batch size and
   * buffered memory. Must be ≥ 1.
   */
  readonly maxBatch: number;
  /**
   * Coalescing window in ms — a non-empty buffer is flushed at most once per
   * this interval. Must be ≥ 0 (0 = flush on next tick).
   */
  readonly windowMs: number;
  /** Called with each non-empty flushed batch, in push order. */
  readonly onFlush: (batch: T[]) => void;
  /** Injected timer (defaults to setTimeout) so tests can drive it deterministically. */
  readonly setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Injected clear (defaults to clearTimeout). */
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class StreamBatcher<T> {
  readonly #maxBatch: number;
  readonly #windowMs: number;
  readonly #onFlush: (batch: T[]) => void;
  readonly #setTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly #clearTimer: (handle: ReturnType<typeof setTimeout>) => void;

  #buffer: T[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  constructor(options: StreamBatcherOptions<T>) {
    if (options.maxBatch < 1) throw new RangeError('maxBatch must be >= 1');
    if (options.windowMs < 0) throw new RangeError('windowMs must be >= 0');
    this.#maxBatch = options.maxBatch;
    this.#windowMs = options.windowMs;
    this.#onFlush = options.onFlush;
    this.#setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.#clearTimer = options.clearTimer ?? ((h) => clearTimeout(h));
  }

  /** Buffer one item. May trigger an immediate flush if the count cap is reached. */
  push(item: T): void {
    if (this.#disposed) return;
    this.#buffer.push(item);
    if (this.#buffer.length >= this.#maxBatch) {
      this.flush();
      return;
    }
    // First item into an empty buffer arms the window timer.
    if (this.#timer === null) {
      this.#timer = this.#setTimer(() => {
        this.#timer = null;
        this.flush();
      }, this.#windowMs);
    }
  }

  /** Flush the current buffer now (if non-empty). Idempotent when empty. */
  flush(): void {
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer);
      this.#timer = null;
    }
    if (this.#buffer.length === 0) return;
    const batch = this.#buffer;
    this.#buffer = [];
    this.#onFlush(batch);
  }

  /** Number of items currently buffered (for tests/diagnostics). */
  get pending(): number {
    return this.#buffer.length;
  }

  /**
   * Stop the batcher. Flushes any remaining items first so nothing is lost on
   * teardown, then rejects further pushes. Idempotent.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.flush();
    this.#disposed = true;
  }
}
