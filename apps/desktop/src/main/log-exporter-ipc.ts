import { z } from 'zod';
import {
  CHANNELS,
  logExportInputSchema,
  type LogExportInput,
  type LogExportOutput,
} from '../shared/ipc/contracts.js';
import type { UnifiedLogEntry } from '@icarus/core';
import type { IpcRouter } from './ipc/router.js';
import { LogExporter } from './log-exporter.js';

/**
 * The desktop wiring of the M3 first slice (E-15, TD-19 follow-on). The pure formatter lives in
 * `core/unified-log/log-export.ts`; this file is the IPC plumbing: a single command channel
 * (`command:log.export`) registered on the typed router, with a `LogExporter` that owns the
 * dialog + file write. Cancelling the dialog is a clean no-op (typed rejection the renderer
 * silently ignores).
 *
 * Kept in its own file (mirrors `assistant-ipc.ts`) so the main entry stays a thin orchestrator.
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

// Re-export the zod schema for convenience in tests that import from this module.
export { z };
