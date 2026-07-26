import { describe, expect, it } from 'vitest';
import type { CdpNetworkEvent } from '../../protocol/cdp/network.js';
import type { UnifiedLogEntry } from '../../unified-log/unified-log.js';
import { buildContextBundle } from './context-bundle.js';
import { aggregateHits } from './report.js';
import { buildAiSendPayload, serializeContext } from './send-payload.js';

const log = (text: string, over: Partial<UnifiedLogEntry> = {}): UnifiedLogEntry => ({
  source: 'cdp',
  level: 'log',
  text,
  timestampMs: 1,
  ...over,
});

describe('aggregateHits', () => {
  it('folds hits into totals per category', () => {
    expect(
      aggregateHits([
        { category: 'email', count: 2 },
        { category: 'jwt', count: 1 },
        { category: 'email', count: 1 },
      ]),
    ).toEqual({ total: 4, byCategory: { email: 3, jwt: 1 } });
  });

  it('is empty for no hits', () => {
    expect(aggregateHits([])).toEqual({ total: 0, byCategory: {} });
  });
});

describe('buildContextBundle', () => {
  it('keeps the most-recent entries within the caps', () => {
    const logs = Array.from({ length: 10 }, (_, i) => log(`line ${i}`));
    const bundle = buildContextBundle({ question: 'q', logs }, { maxLogs: 3 });
    expect(bundle.logs.map((l) => l.text)).toEqual(['line 7', 'line 8', 'line 9']);
  });

  it('honors include flags (category toggles)', () => {
    const bundle = buildContextBundle(
      {
        question: 'q',
        logs: [log('a')],
        network: [{ kind: 'request', requestId: '1', timestampMs: 1, url: 'https://x' }],
      },
      { includeNetwork: false },
    );
    expect(bundle.logs).toHaveLength(1);
    expect(bundle.network).toHaveLength(0);
  });

  it('defaults missing inputs to empty', () => {
    const bundle = buildContextBundle({ question: 'only a question' });
    expect(bundle.logs).toEqual([]);
    expect(bundle.network).toEqual([]);
  });
});

describe('serializeContext', () => {
  it('produces a deterministic, sectioned text form', () => {
    const net: CdpNetworkEvent = {
      kind: 'response',
      requestId: '1',
      timestampMs: 1,
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/users',
    };
    const bundle = buildContextBundle({
      question: 'why 200?',
      logs: [log('hello')],
      network: [net],
    });
    const text = serializeContext(bundle);
    expect(text).toContain('## Question\nwhy 200?');
    expect(text).toContain('## Logs (1)\n[cdp/log] hello');
    expect(text).toContain('## Network (1)\n← 200 OK https://api.example.com/users');
  });

  it('omits empty sections', () => {
    const text = serializeContext(buildContextBundle({ question: 'q' }));
    expect(text).toBe('## Question\nq');
  });

  it('formats request (default method), and failed events', () => {
    const events: CdpNetworkEvent[] = [
      { kind: 'request', requestId: '1', timestampMs: 1, url: 'https://a' }, // no method → GET
      { kind: 'failed', requestId: '2', timestampMs: 2, url: 'https://b', errorText: 'timeout' },
    ];
    const text = serializeContext(buildContextBundle({ question: 'q', network: events }));
    expect(text).toContain('→ GET https://a');
    expect(text).toContain('✗ https://b — timeout');
  });
});

describe('buildAiSendPayload', () => {
  it('returns the redacted text, a report, and a token estimate', () => {
    const bundle = buildContextBundle({ question: 'help', logs: [log('user dev@example.com')] });
    const payload = buildAiSendPayload(bundle);
    expect(payload.text).toContain('[REDACTED:email]');
    expect(payload.report.total).toBe(1);
    expect(payload.report.byCategory).toEqual({ email: 1 });
    expect(payload.approxTokens).toBe(Math.ceil(payload.text.length / 4));
  });

  // T-12.7 — the canary: a planted secret must NEVER survive the boundary, wherever it sits.
  it('CANARY: a secret in a log entry never appears in the payload', () => {
    const secret = 'sk-canary1234567890abcdefzz';
    const bundle = buildContextBundle({
      question: 'debug this',
      logs: [log(`api call with ${secret}`)],
    });
    const payload = buildAiSendPayload(bundle);
    expect(payload.text).not.toContain(secret);
    expect(payload.text).toContain('[REDACTED:api-key]');
    expect(payload.report.byCategory['api-key']).toBe(1);
  });

  it('CANARY: a secret typed into the QUESTION is also redacted', () => {
    const jwt = 'eyJhbGciOi.eyJzdWIi.sigsigsig';
    const payload = buildAiSendPayload(buildContextBundle({ question: `is ${jwt} valid?` }));
    expect(payload.text).not.toContain(jwt);
    expect(payload.text).toContain('[REDACTED:jwt]');
  });

  it('CANARY: a secret in a network URL never appears in the payload', () => {
    const net: CdpNetworkEvent = {
      kind: 'request',
      requestId: '1',
      timestampMs: 1,
      method: 'GET',
      url: 'https://api.example.com/data?token=ghp_' + 'a'.repeat(36),
    };
    const payload = buildAiSendPayload(buildContextBundle({ question: 'q', network: [net] }));
    expect(payload.text).not.toContain('ghp_');
    expect(payload.text).toContain('[REDACTED:api-key]');
  });
});
