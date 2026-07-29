import { aggregateHits, type RedactionReport } from '../ai/boundary/report.js';
import { redact } from '../ai/redaction/redact.js';
import type { UnifiedLogEntry } from './unified-log.js';

/**
 * The M3 first slice (E-15, TD-19 follow-on): an opt-in, one-click **export** of the captured
 * unified log to a user-chosen file. This module is the pure, Electron-free half: it formats a
 * list of `UnifiedLogEntry`s into a JSONL document with a meta header and applies the **same**
 * `redact()` rules the E-12 boundary uses for AI sends. The desktop side handles the file
 * picker, the file write, and the IPC wiring; this is just the formatting.
 *
 * Why JSONL:
 * - Dev-tools convention (`jq`, `grep`, `awk`, one entry per line).
 * - No quoting hell (each line is independent JSON).
 * - The meta header is a `# …` comment so the file is still valid JSONL.
 * - Native to piping into log analysis tools.
 *
 * Why share redaction with E-12: the trust posture of the whole product rests on the boundary.
 * A log export is another place bytes can leave the developer's machine and end up in a bug
 * report / Slack / GitHub. It must not be a back-channel around the AI's redaction. The
 * M3 canary test in `log-export.test.ts` plants a secret and asserts it never survives.
 *
 * The output is **stable line-delimited UTF-8 (LF only)** — Windows-safe in the sense that
 * we never emit CRLF, so the file is grep-friendly on every OS. We escape the few control
 * characters that JSON requires and leave the rest intact (multi-line Metro stderr is fine
 * because each entry is on its own line, and `\\n` in a JSON string is one byte in the file).
 *
 * @see docs/engineering/22-m3-opt-in-log-export.md for the design doc and explicit out-of-scope
 * (network export, replay, auto-export, alternative formats).
 */

/** Stable on-wire shape of one entry in the JSONL file. Field order matches the source so the
 *  diff is greppable; `origin` is omitted when undefined (no `null` clutter). */
export interface LogExportEntry {
  readonly ts: number;
  readonly source: UnifiedLogEntry['source'];
  readonly level: UnifiedLogEntry['level'];
  readonly text: string;
  readonly origin?: string;
}

/** Per-export meta header — written as the first line of the file as a `# …` comment. */
export interface LogExportMeta {
  /** ISO 8601 UTC timestamp of when the export was generated. */
  readonly capturedAtIso: string;
  /** A short, user-readable label for the source (e.g. the Metro project name, or "unified log"). */
  readonly projectLabel: string;
  /** Schema version — bump on any breaking change to the file format. v1 = current. */
  readonly schemaVersion: 1;
  /** Icarus version that produced the export. */
  readonly icarusVersion: string;
}

/** What `buildLogExport` returns: the file text, the redaction report, and a size estimate. */
export interface LogExport {
  /** The full file contents (UTF-8, LF line endings, ends with a trailing LF). */
  readonly text: string;
  /** What was scrubbed, by category — same shape the AI send-payload report uses (TR-5 surface). */
  readonly report: RedactionReport;
  /** Approximate file size in bytes (the UTF-8 length of `text`). */
  readonly approxBytes: number;
}

/** Current Icarus version (manually kept in sync; bump on any format change). */
export const ICARUS_VERSION = '0.0.0';

/**
 * Format the captured log entries into a JSONL file body with a meta header. Every entry's
 * `text` is run through the same `redact()` rules the E-12 AI boundary uses, so a planted
 * secret in a captured entry is guaranteed redacted in the file (M3 canary).
 *
 * Pure: same input → same output; never throws. Empty input still returns a valid file
 * (just the meta header) so the renderer can show "0 entries" honestly.
 */
export function buildLogExport(
  entries: readonly UnifiedLogEntry[],
  meta: LogExportMeta,
): LogExport {
  const allHits: {
    category: import('../ai/redaction/redact.js').RedactionCategory;
    count: number;
  }[] = [];
  const lines: string[] = [formatHeader(entries.length, meta)];
  for (const entry of entries) {
    const { text: redacted, hits } = redact(entry.text);
    allHits.push(...hits);
    const record: LogExportEntry =
      entry.origin !== undefined
        ? {
            ts: entry.timestampMs,
            source: entry.source,
            level: entry.level,
            text: redacted,
            origin: entry.origin,
          }
        : {
            ts: entry.timestampMs,
            source: entry.source,
            level: entry.level,
            text: redacted,
          };
    // JSON.stringify produces stable, parseable output; the entry is on one line by construction
    // (newlines in `text` are escaped as `\n`).
    lines.push(JSON.stringify(record));
  }
  const text = lines.join('\n') + '\n';
  return { text, report: aggregateHits(allHits), approxBytes: utf8ByteLength(text) };
}

/** The default suggested filename for a save dialog — ISO date, no project info. */
export function defaultExportFilename(now: Date = new Date()): string {
  // YYYYMMDD-HHmmss in UTC, no separators that the OS/filesystem would dislike.
  const pad = (n: number): string => n.toString().padStart(2, '0');
  const y = now.getUTCFullYear();
  const m = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mm = pad(now.getUTCMinutes());
  const ss = pad(now.getUTCSeconds());
  return `icarus-log-${y}${m}${d}-${hh}${mm}${ss}.jsonl`;
}

/** @internal The header line: `# Icarus unified-log export · ISO · N entries · icarus@V`. */
function formatHeader(count: number, meta: LogExportMeta): string {
  return (
    `# Icarus unified-log export · ${meta.capturedAtIso} · ${count} entries · ` +
    `${meta.projectLabel} · icarus@${meta.icarusVersion} · schema v${meta.schemaVersion}`
  );
}

/** UTF-8 byte length of a string. Uses TextEncoder when available (Node, modern browsers). */
function utf8ByteLength(s: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++; // surrogate pair
    } else bytes += 3;
  }
  return bytes;
}
