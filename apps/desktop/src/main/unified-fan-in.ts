import type { MetroController, UnifiedLogController } from '@icarus/core';

/**
 * Fan Metro's stdout/stderr into the unified log stream (E-10 / TD-21). The
 * CDP console fan-in already happens inside the CDP session; this closes the
 * other half so the unified panel shows Metro output alongside console entries
 * instead of CDP-only — the whole point of a *unified* log.
 *
 * Lives at the composition root (main) rather than in `core`: the two
 * controllers are independent by design, and wiring them together is an
 * app-level decision, not a `core` coupling (ADR-0002 boundary).
 *
 * Returns an unsubscribe so app-exit teardown can detach the wire before the
 * controllers are disposed.
 */
export function wireMetroIntoUnified(
  metro: Pick<MetroController, 'onLog'>,
  unified: Pick<UnifiedLogController, 'pushMetro'>,
): () => void {
  return metro.onLog((event) => {
    unified.pushMetro(event.stream, event.text, event.timestampMs);
  });
}
