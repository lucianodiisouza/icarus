import type { RedactionCategory, RedactionHit } from '../redaction/redact.js';

/**
 * The aggregate of what a redaction pass scrubbed (E-12, T-12.2). This is the data the
 * "what gets sent" surface (T-12.5) shows the user: how much was removed, by category —
 * proof the boundary did its job before anything leaves the machine.
 */
export interface RedactionReport {
  /** Total replacements across all categories. */
  readonly total: number;
  /** Replacement count per category (only categories that fired appear). */
  readonly byCategory: Partial<Record<RedactionCategory, number>>;
}

/** Fold a flat list of redaction hits into a `RedactionReport`. */
export function aggregateHits(hits: readonly RedactionHit[]): RedactionReport {
  const byCategory: Partial<Record<RedactionCategory, number>> = {};
  let total = 0;
  for (const hit of hits) {
    byCategory[hit.category] = (byCategory[hit.category] ?? 0) + hit.count;
    total += hit.count;
  }
  return { total, byCategory };
}
