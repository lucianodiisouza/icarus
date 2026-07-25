/**
 * Splits a byte/string stream into lines and retains a BOUNDED ring buffer of recent lines
 * (TR-6 discipline: no unbounded in-memory accumulation, even though M0 volume is low).
 * Emits each complete line to subscribers and tracks how many were dropped once the buffer
 * is full. A trailing partial line is flushed on `close()`.
 */
export type LineHandler = (line: string) => void;

export class LineStream {
  readonly #maxLines: number;
  readonly #buffer: string[] = [];
  readonly #handlers = new Set<LineHandler>();
  #pending = '';
  #dropped = 0;
  #closed = false;

  constructor(maxLines = 1000) {
    this.#maxLines = Math.max(1, maxLines);
  }

  /** Feed a chunk of data; complete lines are emitted, the remainder is buffered. */
  push(chunk: string): void {
    if (this.#closed) return;
    this.#pending += chunk;
    let newlineIndex = this.#pending.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.#pending.slice(0, newlineIndex).replace(/\r$/, '');
      this.#pending = this.#pending.slice(newlineIndex + 1);
      this.#emit(line);
      newlineIndex = this.#pending.indexOf('\n');
    }
  }

  /** Flush any trailing partial line and stop accepting input. Idempotent. */
  close(): void {
    if (this.#closed) return;
    if (this.#pending.length > 0) {
      this.#emit(this.#pending);
      this.#pending = '';
    }
    this.#closed = true;
  }

  /** Subscribe to new lines. Returns an unsubscribe function. */
  onLine(handler: LineHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  /** Snapshot of the retained (bounded) lines. */
  lines(): readonly string[] {
    return [...this.#buffer];
  }

  /** How many lines were dropped because the buffer was full. */
  droppedCount(): number {
    return this.#dropped;
  }

  #emit(line: string): void {
    this.#buffer.push(line);
    if (this.#buffer.length > this.#maxLines) {
      this.#buffer.shift();
      this.#dropped++;
    }
    for (const handler of [...this.#handlers]) {
      handler(line);
    }
  }
}
