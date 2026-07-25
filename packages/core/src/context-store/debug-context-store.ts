import { EventBus } from '../event-bus/event-bus.js';
import type { Unsubscribe } from '../event-bus/event-bus.js';

/**
 * The single, structured, observable model of "what is happening in this app right now"
 * (G-3 — the product's moat). Feature modules write typed slices; the UI and the AI
 * assistant read snapshots.
 *
 * Walking-skeleton scope (ADR-0009): plain slices with whole-snapshot subscribe. The
 * batching / delta-streaming machinery is deferred to M1, when the first real
 * high-volume stream (logs) justifies designing it against real load (ADR-0006).
 *
 * @typeParam Slices - a map of slice name -> slice value type.
 */
export class DebugContextStore<Slices extends Record<string, unknown>> {
  readonly #state: Partial<Slices> = {};
  readonly #bus = new EventBus<{ change: { key: keyof Slices } }>();

  /** Read a slice (undefined until first set). */
  get<K extends keyof Slices>(key: K): Slices[K] | undefined {
    return this.#state[key];
  }

  /** Replace a slice and notify subscribers. */
  set<K extends keyof Slices>(key: K, value: Slices[K]): void {
    this.#state[key] = value;
    this.#bus.emit('change', { key });
  }

  /** Immutable shallow snapshot of the whole context (what the AI/UI read). */
  snapshot(): Partial<Slices> {
    return { ...this.#state };
  }

  /** Subscribe to any change; the callback receives the changed key. */
  subscribe(handler: (key: keyof Slices) => void): Unsubscribe {
    return this.#bus.on('change', ({ key }) => handler(key));
  }
}
