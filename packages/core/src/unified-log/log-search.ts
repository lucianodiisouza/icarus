import type { UnifiedLogEntry } from './unified-log.js';

/**
 * Pure search/filter helpers for the unified log stream (E-11). Kept separate from
 * React so they can be unit-tested in isolation and reused by anything that needs
 * to consume the unified stream (a future 'export' feature, an AI summarizer, etc.).
 *
 * All filters compose with AND. Empty filter arguments mean 'no constraint'.
 */

export interface LogFilter {
  /** Case-insensitive substring match against the entry text. */
  readonly text?: string;
  /** Restrict to these sources. Empty/undefined means 'all sources'. */
  readonly sources?: ReadonlySet<UnifiedLogEntry['source']>;
  /** Restrict to these levels. Empty/undefined means 'all levels'. */
  readonly levels?: ReadonlySet<UnifiedLogEntry['level']>;
}

/** Return true if the entry passes every constraint in the filter. */
export function matchesFilter(entry: UnifiedLogEntry, filter: LogFilter): boolean {
  if (filter.text && filter.text.length > 0) {
    if (!entry.text.toLowerCase().includes(filter.text.toLowerCase())) return false;
  }
  if (filter.sources && filter.sources.size > 0) {
    if (!filter.sources.has(entry.source)) return false;
  }
  if (filter.levels && filter.levels.size > 0) {
    if (!filter.levels.has(entry.level)) return false;
  }
  return true;
}

/** Filter an array of entries in place-friendly fashion (returns a new array). */
export function filterEntries<E extends UnifiedLogEntry>(
  entries: readonly E[],
  filter: LogFilter,
): E[] {
  return entries.filter((e) => matchesFilter(e, filter));
}
