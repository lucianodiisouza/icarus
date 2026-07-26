import type { CdpNetworkEvent } from '../../protocol/cdp/network.js';
import type { UnifiedLogEntry } from '../../unified-log/unified-log.js';

/**
 * A selected, bounded, model-ready slice of debug context (E-12, T-12.3). It is what the
 * assistant *could* reason over, before redaction — assembling it is deliberately separate
 * from sending it, so what leaves the machine is always the explicit, bounded output of
 * `buildAiSendPayload`, never the raw live context.
 */
export interface ContextBundle {
  readonly question: string;
  readonly logs: readonly UnifiedLogEntry[];
  readonly network: readonly CdpNetworkEvent[];
}

export interface ContextBundleInput {
  readonly question: string;
  readonly logs?: readonly UnifiedLogEntry[];
  readonly network?: readonly CdpNetworkEvent[];
}

export interface ContextBundleOptions {
  /** Include captured logs (default true). The user's category toggle (T-12.6) drives this. */
  readonly includeLogs?: boolean;
  /** Include captured network events (default true). */
  readonly includeNetwork?: boolean;
  /** Keep at most this many most-recent log entries (default 200). */
  readonly maxLogs?: number;
  /** Keep at most this many most-recent network events (default 50). */
  readonly maxNetwork?: number;
}

const DEFAULTS = { maxLogs: 200, maxNetwork: 50 } as const;

/** Keep the most-recent `max` items (the tail); the arrays are already chronological. */
function recent<T>(items: readonly T[] | undefined, include: boolean, max: number): readonly T[] {
  if (!include || items === undefined || items.length === 0) return [];
  return items.length > max ? items.slice(items.length - max) : items;
}

/**
 * Build a bounded, category-filtered context bundle. Bounding is by construction here (count
 * caps + include flags), so no live stream can blow up the eventual payload.
 */
export function buildContextBundle(
  input: ContextBundleInput,
  options: ContextBundleOptions = {},
): ContextBundle {
  return {
    question: input.question,
    logs: recent(input.logs, options.includeLogs ?? true, options.maxLogs ?? DEFAULTS.maxLogs),
    network: recent(
      input.network,
      options.includeNetwork ?? true,
      options.maxNetwork ?? DEFAULTS.maxNetwork,
    ),
  };
}
