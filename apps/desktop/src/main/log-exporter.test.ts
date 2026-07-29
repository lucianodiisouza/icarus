import { describe, expect, it } from 'vitest';
import { ExportCancelledError, LogExporter, type LogExporterDeps } from './log-exporter.js';
import type { UnifiedLogEntry } from '@icarus/core';

/**
 * M3 first-slice desktop tests (E-15). The pure formatter is exercised end-to-end in
 * `core/src/unified-log/log-export.test.ts` (the M3 canary lives there). These tests cover
 * the desktop-bound wiring: the snapshot → dialog → write path, with the dialog and write
 * both stubbed so the test never needs a window or a real filesystem.
 */

const SECRET = 'sk-abcdefghijklmnop1234';
const NOW = new Date('2026-07-29T18:56:07.000Z');

function entry(over: Partial<UnifiedLogEntry> & { text: string }): UnifiedLogEntry {
  return { source: 'cdp', level: 'info', timestampMs: 1, ...over };
}

interface TestHarness {
  readonly exporter: LogExporter;
  readonly writes: { path: string; data: string }[];
  readonly picks: string[];
  setPickResult(next: string | null): void;
  setWriteError(next: Error | null): void;
}

function makeExporter(over: Partial<LogExporterDeps> = {}): TestHarness {
  const writes: { path: string; data: string }[] = [];
  const picks: string[] = [];
  let pickResult: string | null = '/tmp/chosen.jsonl';
  let writeError: Error | null = null;
  const exporter = new LogExporter({
    pickPath:
      over.pickPath ??
      (async (suggested) => {
        picks.push(suggested);
        return pickResult;
      }),
    write:
      over.write ??
      (async (path, data) => {
        if (writeError) throw writeError;
        writes.push({ path, data });
      }),
    projectLabel: over.projectLabel ?? (() => 'unified log'),
    ...(over.now ? { now: over.now } : { now: () => NOW }),
  });
  return {
    exporter,
    writes,
    picks,
    setPickResult: (next) => {
      pickResult = next;
    },
    setWriteError: (next) => {
      writeError = next;
    },
  };
}

describe('LogExporter — happy path', () => {
  it('picks a default filename, formats the entries, and writes the file', async () => {
    const t = makeExporter({
      projectLabel: () => 'my-app',
    });
    const out = await t.exporter.export([
      entry({ text: 'hello' }),
      entry({ text: 'world', source: 'metro' }),
    ]);
    // The default filename is in UTC, deterministic for the injected clock.
    expect(t.picks).toEqual(['icarus-log-20260729-185607.jsonl']);
    expect(out.path).toBe('/tmp/chosen.jsonl');
    expect(out.count).toBe(2);
    expect(out.approxBytes).toBeGreaterThan(0);
    // The written file is the formatted JSONL.
    expect(t.writes).toHaveLength(1);
    const written = t.writes[0]!;
    expect(written.path).toBe('/tmp/chosen.jsonl');
    expect(
      written.data.startsWith(
        '# Icarus unified-log export · 2026-07-29T18:56:07.000Z · 2 entries · my-app · ',
      ),
    ).toBe(true);
    // One JSON object per entry, on its own line.
    const lines = written.data.trimEnd().split('\n');
    expect(lines).toHaveLength(3); // header + 2 entries
  });

  it('passes the project label through to the meta header', async () => {
    const t = makeExporter({ projectLabel: () => 'rnstudio-spike' });
    await t.exporter.export([entry({ text: 'a' })]);
    expect(t.writes[0]!.data).toContain('· rnstudio-spike ·');
  });

  it('falls back to "unified log" when no project is running', async () => {
    const t = makeExporter();
    await t.exporter.export([entry({ text: 'a' })]);
    expect(t.writes[0]!.data).toContain('· unified log ·');
  });
});

describe('LogExporter — redaction (M3 canary at the boundary)', () => {
  // The trust-critical gate at the desktop boundary too: a planted secret in the live log must
  // never reach the file the user picked. (The core-level canary is in `log-export.test.ts`; this
  // is the same gate, exercised through the desktop wiring, to catch any regression where a
  // future refactor accidentally bypasses `buildLogExport`.)
  it('redacts a planted secret in the entries before the file is written', async () => {
    const t = makeExporter();
    const out = await t.exporter.export([entry({ text: `login failed; key was ${SECRET}` })]);
    const written = t.writes[0]!.data;
    expect(written).not.toContain(SECRET);
    expect(written).toContain('[REDACTED:api-key]');
    expect(out.report.byCategory?.['api-key']).toBe(1);
  });
});

describe('LogExporter — failure paths', () => {
  it('cancelled dialog → ExportCancelledError, no write', async () => {
    const t = makeExporter();
    t.setPickResult(null);
    await expect(t.exporter.export([entry({ text: 'a' })])).rejects.toBeInstanceOf(
      ExportCancelledError,
    );
    expect(t.writes).toHaveLength(0);
  });

  it('file write failure propagates as a typed rejection (no silent swallow)', async () => {
    const t = makeExporter();
    t.setWriteError(new Error('EACCES: permission denied'));
    await expect(t.exporter.export([entry({ text: 'a' })])).rejects.toThrow(/permission denied/);
    // No retry, no fallback: the rejection is what the renderer will surface.
  });

  it('zero entries still produces a valid (just-header) file', async () => {
    const t = makeExporter();
    const out = await t.exporter.export([]);
    expect(out.count).toBe(0);
    expect(t.writes[0]!.data).toMatch(/^# Icarus unified-log export · .* · 0 entries ·/);
  });
});
