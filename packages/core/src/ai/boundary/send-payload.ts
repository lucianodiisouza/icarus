import type { CdpNetworkEvent } from '../../protocol/cdp/network.js';
import type { UnifiedLogEntry } from '../../unified-log/unified-log.js';
import { redact } from '../redaction/redact.js';
import type { ContextBundle } from './context-bundle.js';
import { aggregateHits, type RedactionReport } from './report.js';

/**
 * The exact, redacted bytes that will be sent to the model, plus the redaction report and a
 * rough size estimate (E-12, T-12.4). **This is the single choke point of the AI data
 * boundary:** nothing reaches a provider except a `SendPayload`, and a payload is only ever
 * produced by `buildAiSendPayload`, which redacts the *whole serialized context* as its last
 * step. That's what makes the canary test (T-12.7) hold by construction — there is no path
 * that serializes context without redacting it.
 */
export interface SendPayload {
  /** Exactly what will be sent — already redacted. */
  readonly text: string;
  /** What redaction removed, for the visible "what gets sent" surface (T-12.5). */
  readonly report: RedactionReport;
  /** Rough token estimate (~4 chars/token) for cost/budget visibility. */
  readonly approxTokens: number;
}

const CHARS_PER_TOKEN = 4;

function formatLog(entry: UnifiedLogEntry): string {
  const origin = entry.origin ? ` (${entry.origin})` : '';
  return `[${entry.source}/${entry.level}] ${entry.text}${origin}`;
}

function formatNetwork(event: CdpNetworkEvent): string {
  if (event.kind === 'request') return `→ ${event.method ?? 'GET'} ${event.url ?? ''}`.trimEnd();
  if (event.kind === 'response') {
    return `← ${event.status ?? ''} ${event.statusText ?? ''} ${event.url ?? ''}`.trim();
  }
  return `✗ ${event.url ?? ''} — ${event.errorText ?? 'failed'}`.trim();
}

/** Canonical, deterministic text form of a bundle (pre-redaction). */
export function serializeContext(bundle: ContextBundle): string {
  const parts: string[] = [`## Question\n${bundle.question}`];
  if (bundle.logs.length > 0) {
    parts.push(`## Logs (${bundle.logs.length})\n${bundle.logs.map(formatLog).join('\n')}`);
  }
  if (bundle.network.length > 0) {
    const lines = bundle.network.map(formatNetwork).join('\n');
    parts.push(`## Network (${bundle.network.length})\n${lines}`);
  }
  return parts.join('\n\n');
}

/**
 * Assemble the redacted send payload. Serializes the bundle, then runs the redaction pass
 * over the **entire** text (including the user's question) — so every field and every seam
 * between fields is covered, and no un-redacted path to the model exists.
 */
export function buildAiSendPayload(bundle: ContextBundle): SendPayload {
  const { text, hits } = redact(serializeContext(bundle));
  return {
    text,
    report: aggregateHits(hits),
    approxTokens: Math.ceil(text.length / CHARS_PER_TOKEN),
  };
}
