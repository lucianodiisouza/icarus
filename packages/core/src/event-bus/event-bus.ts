/**
 * A tiny typed publish/subscribe bus for in-process communication between the core and
 * (later) feature modules. Deliberately minimal for the walking skeleton: no batching or
 * backpressure yet — those arrive in M1 with the first real high-volume stream (ADR-0006,
 * ADR-0009). Kept Electron-free (ADR-0002).
 *
 * @typeParam Events - a map of event name -> payload type.
 */
export type EventMap = Record<string, unknown>;

export type Unsubscribe = () => void;

export class EventBus<Events extends EventMap> {
  readonly #handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): Unsubscribe {
    let set = this.#handlers.get(event);
    if (!set) {
      set = new Set();
      this.#handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => {
      set?.delete(handler as (payload: never) => void);
    };
  }

  /**
   * Subscribe to an event for a single emission, then auto-unsubscribe.
   */
  once<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): Unsubscribe {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  /**
   * Emit an event. A throwing handler does not prevent the others from running; the
   * error is surfaced to onHandlerError rather than swallowed (Coding Standards: no
   * silent failure).
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.#handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as (payload: Events[K]) => void)(payload);
      } catch (error) {
        this.onHandlerError(event, error);
      }
    }
  }

  /**
   * Number of handlers registered for an event (useful in tests/diagnostics).
   */
  listenerCount<K extends keyof Events>(event: K): number {
    return this.#handlers.get(event)?.size ?? 0;
  }

  /**
   * Remove all handlers. Used on teardown.
   */
  clear(): void {
    this.#handlers.clear();
  }

  /**
   * Override to route handler errors somewhere real (e.g. the Logger). Default rethrows
   * asynchronously so a broken handler is loud, not lost.
   */
  protected onHandlerError(event: keyof Events, error: unknown): void {
    queueMicrotask(() => {
      throw error instanceof Error
        ? error
        : new Error(`EventBus handler for "${String(event)}" threw: ${String(error)}`);
    });
  }
}
