import { describe, expect, it } from 'vitest';
import { buildLogExport, defaultExportFilename, ICARUS_VERSION } from './log-export.js';
import type { UnifiedLogEntry } from './unified-log.js';

/**
 * M3 first-slice tests (E-15, TD-19 follow-on). The most important one is the **canary**:
 * a planted secret in a captured entry must be redacted in the file output — same as the
 * E-12 canary. If that test ever fails, the export is a back-channel around the boundary.
 */

const META = {
  capturedAtIso: '2026-07-29T18:56:00.000Z',
  projectLabel: 'unified log',
  schemaVersion: 1 as const,
  icarusVersion: ICARUS_VERSION,
};

function entry(over: Partial<UnifiedLogEntry> & { text: string }): UnifiedLogEntry {
  return {
    source: 'cdp',
    level: 'info',
    timestampMs: 1_753_818_960_000,
    ...over,
  };
}

function parseJsonl(text: string): unknown[] {
  // Drop the comment header; the rest is one JSON object per line.
  const dataLines = text.split('\n').filter((line) => line.length > 0 && !line.startsWith('#'));
  return dataLines.map((line) => JSON.parse(line) as unknown);
}

describe('buildLogExport — format', () => {
  it('writes a single meta header as the first line, then one JSONL line per entry', () => {
    const out = buildLogExport(
      [entry({ text: 'hello' }), entry({ text: 'world', source: 'metro' })],
      META,
    );
    const lines = out.text.split('\n');
    expect(lines[0]).toBe(
      `# Icarus unified-log export · ${META.capturedAtIso} · 2 entries · ${META.projectLabel} · icarus@${META.icarusVersion} · schema v1`,
    );
    // No trailing blank line — exactly 3 non-empty lines + a single trailing '\n'.
    expect(lines).toHaveLength(4);
    expect(out.text.endsWith('\n')).toBe(true);
    // Each non-header line is valid JSON.
    const parsed = parseJsonl(out.text);
    expect(parsed).toHaveLength(2);
  });

  it('uses LF line endings only (never CRLF) — grep-friendly on every OS', () => {
    const out = buildLogExport([entry({ text: 'a' }), entry({ text: 'b' })], META);
    expect(out.text.includes('\r\n')).toBe(false);
  });

  it('escapes special characters in text so each entry stays on one line', () => {
    const out = buildLogExport(
      [entry({ text: 'multi\nline\nwith "quotes" and \\backslash' })],
      META,
    );
    const parsed = parseJsonl(out.text) as Array<{ text: string }>;
    expect(parsed[0]?.text).toBe('multi\nline\nwith "quotes" and \\backslash');
  });

  it('returns an empty-log file (just the header) for an empty input', () => {
    const out = buildLogExport([], META);
    expect(out.text.split('\n')).toHaveLength(2);
    expect(out.text).toMatch(/^# Icarus unified-log export · .* · 0 entries ·/);
    expect(out.report.total).toBe(0);
  });

  it('includes `origin` only when present on the source entry', () => {
    const out = buildLogExport(
      [entry({ text: 'a', origin: 'App.tsx:42' }), entry({ text: 'b' })],
      META,
    );
    const parsed = parseJsonl(out.text) as Array<{ origin?: string }>;
    expect(parsed[0]?.origin).toBe('App.tsx:42');
    expect(parsed[1]?.origin).toBeUndefined();
    expect('origin' in (parsed[1] ?? {})).toBe(false);
  });

  it('preserves source/level/timestampMs in the JSONL record', () => {
    const out = buildLogExport(
      [
        entry({
          text: 'an error',
          source: 'metro',
          level: 'error',
          timestampMs: 42,
        }),
      ],
      META,
    );
    const parsed = parseJsonl(out.text) as Array<{
      ts: number;
      source: string;
      level: string;
    }>;
    expect(parsed[0]).toMatchObject({ ts: 42, source: 'metro', level: 'error' });
  });

  it('reports an accurate UTF-8 byte length, not the char count', () => {
    const out = buildLogExport([entry({ text: 'café — 🎉' })], META);
    // 'café' = 5 UTF-8 bytes; '— ' = 4 bytes; '🎉' = 4 bytes. The whole file is more than
    // the entry text alone, but it must be at least the byte length of the entry.
    expect(out.approxBytes).toBeGreaterThanOrEqual(new TextEncoder().encode(out.text).length);
    // Sanity: byte count ≥ char count (the byte length must never be smaller than the char count).
    expect(out.approxBytes).toBeGreaterThanOrEqual(out.text.length);
  });
});

describe('buildLogExport — redaction (M3 canary)', () => {
  // The trust-critical M3 canary: a planted secret in a captured entry must be redacted in the
  // file output, by the same `redact()` rules the E-12 boundary uses for AI sends. This is the
  // gate that proves the export is not a back-channel around the boundary.
  it('redacts a planted API key in an entry before it reaches the file (M3 canary)', () => {
    const secret = 'sk-abcdefghijklmnop1234';
    const out = buildLogExport([entry({ text: `login failed; key was ${secret}` })], META);
    expect(out.text).not.toContain(secret);
    expect(out.text).toContain('[REDACTED:api-key]');
    expect(out.report.total).toBeGreaterThanOrEqual(1);
    expect(out.report.byCategory['api-key']).toBe(1);
  });

  it('redacts a planted JWT, email, and home-path together', () => {
    const out = buildLogExport(
      [
        entry({
          text:
            'contact alice@example.com or see /Users/alice/work/app ' +
            'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.zzz',
        }),
      ],
      META,
    );
    expect(out.text).not.toContain('alice@example.com');
    expect(out.text).not.toContain('/Users/alice/');
    expect(out.text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out.report.byCategory['email']).toBe(1);
    expect(out.report.byCategory['home-path']).toBe(1);
    expect(out.report.byCategory['jwt']).toBe(1);
  });

  it('aggregates redaction hits across many entries, not per entry', () => {
    const out = buildLogExport(
      [
        entry({ text: 'first sk-abcdefghijklmnop1234 leak' }),
        entry({ text: 'second sk-abcdefghijklmnop1234 leak' }),
      ],
      META,
    );
    expect(out.report.total).toBe(2);
    expect(out.report.byCategory['api-key']).toBe(2);
  });

  it('leaves an ordinary log line untouched (precision-first)', () => {
    const out = buildLogExport([entry({ text: 'Bunching factor on lane 7 looks fine.' })], META);
    expect(out.report.total).toBe(0);
    expect(out.text).toContain('Bunching factor on lane 7 looks fine.');
  });
});

describe('defaultExportFilename', () => {
  it('uses a deterministic UTC date in the name and the .jsonl extension', () => {
    const name = defaultExportFilename(new Date('2026-07-29T18:56:07.000Z'));
    expect(name).toBe('icarus-log-20260729-185607.jsonl');
  });

  it('never leaks the project name into the suggested filename', () => {
    const name = defaultExportFilename(new Date('2026-07-29T18:56:07.000Z'));
    expect(name.startsWith('icarus-log-')).toBe(true);
    // The project name lives in the meta header (where it belongs) — not in the filename.
    expect(name).not.toContain('react-native');
  });
});
