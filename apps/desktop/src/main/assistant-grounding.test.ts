import { describe, expect, it } from 'vitest';
import type { AIProvider, KeyStore, UnifiedLogEntry } from '@icarus/core';
import { collectAnswer } from '@icarus/core';
import { AssistantBridge } from './assistant-bridge.js';

/**
 * The grounding acceptance test (E-13, T-13.7) — the G-6 / PR-2 gate. It proves the two claims the
 * whole assistant rests on, end-to-end through the real `AssistantBridge` and the real E-12
 * boundary (only the provider and key store are faked — no network, no Electron):
 *
 *   1. G-6: the assistant answers using data the user did **not** paste. The question never
 *      mentions the crash; the only place the error exists is the captured log context. If the
 *      model can name it, it was grounded on non-pasted data.
 *   2. The E-12 boundary holds: a secret sitting in that same captured context is redacted before
 *      anything reaches the provider. Grounding does not become a secret-exfiltration path.
 */

const entry = (
  level: UnifiedLogEntry['level'],
  text: string,
  timestampMs: number,
): UnifiedLogEntry => ({
  source: 'cdp',
  level,
  text,
  timestampMs,
});

function fakeKeyStore(key: string): KeyStore {
  return {
    get: () => Promise.resolve(key),
    set: () => Promise.resolve(),
    clear: () => Promise.resolve(),
  };
}

describe('assistant grounding (E-13 T-13.7 · G-6 / PR-2 gate)', () => {
  it('answers from captured context the user did not paste, within the E-12 boundary', async () => {
    // A distinctive error that lives ONLY in the captured logs — never in the question.
    const capturedError = 'TypeError: undefined is not an object (evaluating user.profile.name)';
    // A secret sitting in the same captured context; the boundary must strip it before egress.
    const secret = 'authToken=sk-abcdefghijklmnop1234';
    const question = 'why did my app crash?'; // deliberately says nothing about the error

    // The provider captures exactly what crossed the boundary, and answers by quoting the context
    // it received — a grounded model would name the captured symbol.
    let received: string | undefined;
    const provider: AIProvider = {
      async *ask(request) {
        received = request.content;
        yield { text: 'The crash is a TypeError while reading user.profile.name.' };
      },
    };

    const bridge = new AssistantBridge({
      keyStore: fakeKeyStore('sk-user-key'),
      secureStorageAvailable: () => true,
      makeProvider: () => provider,
      logSnapshot: () => [entry('error', capturedError, 1), entry('info', secret, 2)],
      networkSnapshot: () => [],
    });

    const { payload, answer } = await bridge.ask({ question });
    const text = await collectAnswer(answer);

    // Guard the premise: the error text is not in the question, so any grounding is non-pasted.
    expect(question).not.toContain('TypeError');

    // G-6 — the model saw the captured error, and its answer is grounded on it.
    expect(received).toContain(capturedError);
    expect(payload.text).toContain(capturedError);
    expect(text).toContain('user.profile.name');

    // E-12 boundary — the secret in the same context was redacted before it left the machine.
    expect(received).not.toContain('sk-abcdefghijklmnop1234');
    expect(payload.text).not.toContain('sk-abcdefghijklmnop1234');
    expect(payload.report.byCategory['api-key']).toBeGreaterThanOrEqual(1);

    // The exact bytes the provider received are exactly the redacted payload — no side channel.
    expect(received).toBe(payload.text);
  });
});
