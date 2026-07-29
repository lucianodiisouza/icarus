import { writeFile } from 'node:fs/promises';
import { dialog, type BrowserWindow } from 'electron';
import { z } from 'zod';
import {
  CHANNELS,
  logExportInputSchema,
  type LogExportInput,
  type LogExportOutput,
} from '../shared/ipc/contracts.js';
import type { UnifiedLogEntry } from '@icarus/core';
import type { IpcRouter } from './ipc/router.js';
import { LogExporter, type LogExporterDeps } from './log-exporter.js';

/**
 * The desktop wiring of the M3 first slice (E-15, TD-19 follow-on). The pure formatter lives in
 * `core/unified-log/log-export.ts`; the Electron-free `LogExporter` lives in `log-exporter.ts`;
 * this file is the Electron-bound half — the IPC plumbing and the production factory for the
 * `LogExporter`'s injected deps.
 *
 * Why the split: the unit-test runner does not have the Electron binary installed (only the
 * e2e job does), and `import { dialog } from 'electron'` at module-load time crashes a cold
 * runner with "Electron failed to install correctly" — even for test files that never use
 * Electron. Keeping `electron` imports out of `log-exporter.ts` (which has a sibling test
 * file) matches the `assistant-bridge.ts` / `assistant-ipc.ts` split.
 */
export function registerLogExportChannel(router: IpcRouter, exporter: LogExporter): void {
  router.register(
    CHANNELS.LOG_EXPORT,
    logExportInputSchema,
    async ({ entries }: LogExportInput): Promise<LogExportOutput> =>
      exporter.export(toCoreEntries(entries)),
  );
}

/**
 * The Zod schema for the IPC input has `origin?: string` (the Zod-derived type), while
 * `UnifiedLogEntry.origin` is `string` (exactOptionalPropertyTypes). Strip undefined keys here
 * so the array satisfies the core type without coercing data.
 */
function toCoreEntries(entries: LogExportInput['entries']): readonly UnifiedLogEntry[] {
  return entries.map((e) => {
    if (e.origin === undefined) {
      const { origin: _unused, ...rest } = e;
      void _unused;
      return rest as UnifiedLogEntry;
    }
    return e as UnifiedLogEntry;
  });
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

// Re-export the zod schema for convenience in tests that import from this module.
export { z };
