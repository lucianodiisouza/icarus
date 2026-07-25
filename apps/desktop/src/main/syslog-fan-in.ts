import type { NativeLogSourceLike, UnifiedLogController } from '@icarus/core';

/**
 * Fan a booted simulator's native syslog into the unified log (TD-18 / E-10).
 * This is the third and last unified-log source — CDP console (per-window) and
 * Metro output (`wireMetroIntoUnified`) are already wired; this closes the set
 * so the unified panel truly unifies *all* of "what just happened in the app".
 *
 * ## Policy (v1)
 *
 * One syslog stream at a time, following the **most recently booted** simulator.
 * `start(udid)` is called from the `devices.boot` handler; booting a second sim
 * replaces the stream rather than multiplexing several. This mirrors the
 * auto-attach "first booted sim" simplicity (TD-16) and resolves the "which
 * udid when several are booted" question TD-18 flagged: we follow the user's
 * most recent explicit boot. Multiplexing multiple simulators' logs is a
 * deliberate non-goal for v1 — revisit with design-partner feedback.
 *
 * Lives at the composition root (main), like the other fan-ins: it wires two
 * independent core pieces (a native source + the unified controller) together,
 * which is an app-level decision, not a `core` coupling (ADR-0002).
 */
export class SyslogFanIn {
  readonly #unified: Pick<UnifiedLogController, 'pushNative'>;
  readonly #createSource: (udid: string) => NativeLogSourceLike;
  #current: { udid: string; source: NativeLogSourceLike; off: () => void } | null = null;

  constructor(deps: {
    unified: Pick<UnifiedLogController, 'pushNative'>;
    /** Factory for a native log source; injected so tests don't spawn `simctl`. */
    createSource: (udid: string) => NativeLogSourceLike;
  }) {
    this.#unified = deps.unified;
    this.#createSource = deps.createSource;
  }

  /**
   * Start streaming the given simulator's syslog into the unified log. If the
   * same udid is already streaming, this is a no-op; a different udid replaces
   * the current stream. Fire-and-forget: the previous stream's `stop()` runs in
   * the background so booting stays responsive.
   */
  start(udid: string): void {
    if (this.#current?.udid === udid && this.#current.source.isRunning()) return;
    void this.#stopCurrent();
    const source = this.#createSource(udid);
    const off = source.onLine((line) => {
      this.#unified.pushNative(line);
    });
    this.#current = { udid, source, off };
  }

  /** Stop the active stream (if any). Idempotent; safe to call on app exit. */
  async stop(): Promise<void> {
    await this.#stopCurrent();
  }

  /** The udid currently being streamed, or null. */
  get activeUdid(): string | null {
    return this.#current?.udid ?? null;
  }

  async #stopCurrent(): Promise<void> {
    const cur = this.#current;
    this.#current = null;
    if (!cur) return;
    cur.off();
    await cur.source.stop();
  }
}
