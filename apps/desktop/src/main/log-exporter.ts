import { writeFile } from 'node:fs/promises';
import { dialog, type BrowserWindow } from 'electron';
import {
  buildLogExport,
  defaultExportFilename,
  ICARUS_VERSION,
  type LogExport,
  type RedactionReport,
  type UnifiedLogEntry,
} from '@icarus/core';

/**
 * The desktop side of the M3 first slice (E-15, TD-19 follow-on). The pure formatter lives in
 * `core/unified-log/log-export.ts` and runs the same `redact()` rules as the E-12 AI boundary —
 * see that module for the design contract and the M3 canary rationale. This file is the
 * Electron-bound wiring: take the renderer's currently-visible entries, show a Save dialog,
 * write the file, return exactly what was written and what was redacted.
 *
 * Everything injectable is injected:
 *   - `pickPath` is the file-picker seam (real: `showSaveDialog`, test: a stub)
 *   - `write` is the bytes-to-disk seam (real: `writeFile`, test: a stub)
 *   - `now` and `projectLabel` are pure inputs the production path fills from the app state.
 *
 * That keeps the whole thing unit-testable without a window or a filesystem, mirroring the
 * `AssistantBridge` shape (T-13.5) and the reaper's injected store (TD-11).
 */

export interface LogExporterDeps {
  /** Show the OS save dialog and return the chosen path, or `null` if the user cancelled. */
  readonly pickPath: (suggestedName: string) => Promise<string | null>;
  /** Write the formatted bytes to the chosen path. */
  readonly write: (path: string, data: string) => Promise<void>;
  /** A human-readable project label to embed in the file's meta header. */
  readonly projectLabel: () => string;
  /** Current time (testable). */
  readonly now?: () => Date;
}

/** What a successful export returns to the renderer — the path written + the report. */
export interface LogExportResult {
  /** Absolute path the user picked; the file is at this location. */
  readonly path: string;
  /** Number of log entries that were written. */
  readonly count: number;
  /** What redaction scrubbed, by category — same shape as the AI send-payload report. */
  readonly report: RedactionReport;
  /** Approximate file size in bytes. */
  readonly approxBytes: number;
}

/** What an export returns when the user cancels the save dialog. */
export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled — no file was written.');
    this.name = 'ExportCancelledError';
  }
}

export class LogExporter {
  constructor(private readonly deps: LogExporterDeps) {}

  /**
   * Run an export end-to-end:
   *   1. Show a Save dialog with a default filename (no project name leaks into the filename).
   *   2. Format the file (the M3 core half — redaction always-on).
   *   3. Write the file. Surface the typed result.
   *
   * The renderer's `entries` are the ones to write — the renderer's filter chips + search
   * query are the user's intent, and main doesn't have that information. Redaction still
   * runs on every entry text in `core/.../log-export.ts`, so a planted secret in any entry
   * is scrubbed before the file is written.
   *
   * Throws `ExportCancelledError` if the user cancels — the renderer treats this as a clean
   * no-op (no error toast, no spinner stuck). Any other error (permission, disk full) propagates
   * as the IPC rejection so the renderer can show it.
   */
  async export(entries: readonly UnifiedLogEntry[]): Promise<LogExportResult> {
    const now = this.deps.now?.() ?? new Date();
    const path = await this.deps.pickPath(defaultExportFilename(now));
    if (path === null) throw new ExportCancelledError();

    const out: LogExport = buildLogExport(entries, {
      capturedAtIso: now.toISOString(),
      projectLabel: this.deps.projectLabel(),
      schemaVersion: 1,
      icarusVersion: ICARUS_VERSION,
    });
    await this.deps.write(path, out.text);

    return { path, count: entries.length, report: out.report, approxBytes: out.approxBytes };
  }
}

/**
 * The production wiring: a real OS save dialog scoped to a window, and a real `writeFile` write.
 * Kept as a small factory so the rest of the wiring (the IPC channel handler) can stay
 * type-agnostic and a test can drop in fakes without dragging Electron in.
 */
export function createDefaultLogExporterDeps(deps: {
  readonly parentWindow: () => BrowserWindow | null;
  readonly projectLabel: () => string;
}): LogExporterDeps {
  return {
    projectLabel: deps.projectLabel,
    pickPath: async (suggestedName) => {
      const parent = deps.parentWindow();
      const result = parent
        ? await dialog.showSaveDialog(parent, {
            title: 'Export unified log',
            defaultPath: suggestedName,
            filters: [
              { name: 'JSON Lines', extensions: ['jsonl'] },
              { name: 'All files', extensions: ['*'] },
            ],
          })
        : await dialog.showSaveDialog({
            title: 'Export unified log',
            defaultPath: suggestedName,
            filters: [
              { name: 'JSON Lines', extensions: ['jsonl'] },
              { name: 'All files', extensions: ['*'] },
            ],
          });
      // The Electron dialog returns `{ canceled, filePath }`; map the cancel case to `null`
      // (the rest of the exporter only cares "did the user pick a path or not").
      return result.canceled ? null : result.filePath;
    },
    write: async (path, data) => {
      await writeFile(path, data, 'utf8');
    },
  };
}
