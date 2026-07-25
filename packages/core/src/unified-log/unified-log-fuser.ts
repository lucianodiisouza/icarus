import { parseSyslogLine } from '../native-logs/ios-syslog.js';
import type { CdpConsoleEntry } from '../protocol/cdp/console.js';
import type { MetroLogEvent } from '../metro/metro-controller.js';
import type { UnifiedLogEntry, UnifiedLogLevel, UnifiedLogSource } from './unified-log.js';

export type { UnifiedLogSource } from './unified-log.js';

/**
 * Fusers: turn the typed event from each source into the unified shape. Pure — they
 * take an event + a `now()` for default timestamps, and return a UnifiedLogEntry
 * (or null when the input can't be normalized, e.g. a syslog line with no level).
 *
 * Keeping these as small pure functions makes them trivial to test and easy to extend
 * when a new source lands (Android logcat, future modules, …).
 */
export function fuseCdp(entry: CdpConsoleEntry): UnifiedLogEntry {
  const level: UnifiedLogLevel = normalizeLevel(entry.level);
  return { source: 'cdp', level, text: entry.text, timestampMs: entry.timestampMs };
}

export function fuseMetro(event: MetroLogEvent, now: () => number): UnifiedLogEntry {
  return {
    source: 'metro',
    level: event.stream === 'stderr' ? 'warn' : 'info',
    text: event.text,
    timestampMs: event.timestampMs ?? now(),
  };
}

export function fuseNative(line: string, now: () => number): UnifiedLogEntry | null {
  const parsed = parseSyslogLine(line);
  if (!parsed) return null;
  return {
    source: 'native' satisfies UnifiedLogSource,
    level: normalizeLevel(parsed.level),
    text: parsed.text,
    timestampMs: now(),
  };
}

function normalizeLevel(raw: string): UnifiedLogLevel {
  const l = raw.toLowerCase();
  if (l === 'warning' || l === 'warn') return 'warn';
  if (l === 'error' || l === 'err' || l === 'fault' || l === 'critical') return 'error';
  if (l === 'info' || l === 'notice') return 'info';
  if (l === 'debug') return 'debug';
  return 'log';
}
