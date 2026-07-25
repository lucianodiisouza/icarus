/**
 * A fixed-capacity ring buffer (E-03s). Retains the most recent `capacity`
 * items, dropping the oldest as new ones arrive. Backs the subscription
 * **snapshot**: a late subscriber gets the recent history, not the whole
 * unbounded log, so both memory and initial-payload size stay bounded.
 *
 * Kept deliberately tiny and allocation-light on the hot path (`push` is O(1)
 * amortized). `snapshot()` returns a plain array in oldest→newest order.
 */
export class RingBuffer<T> {
  readonly #capacity: number;
  #items: T[] = [];

  constructor(capacity: number) {
    if (capacity < 1) throw new RangeError('capacity must be >= 1');
    this.#capacity = capacity;
  }

  /** Append one item, evicting the oldest if at capacity. */
  push(item: T): void {
    this.#items.push(item);
    if (this.#items.length > this.#capacity) {
      // Trim in a batch rather than shift-per-push; only runs once we exceed cap.
      this.#items = this.#items.slice(this.#items.length - this.#capacity);
    }
  }

  /** Oldest→newest copy of the retained items. */
  snapshot(): T[] {
    return [...this.#items];
  }

  /** Current retained count (≤ capacity). */
  get size(): number {
    return this.#items.length;
  }

  /** Drop all retained items. */
  clear(): void {
    this.#items = [];
  }
}
