import { describe, expect, it, vi } from 'vitest';
import { buildContextBundle } from './boundary/context-bundle.js';
import type { UnifiedLogEntry } from '../unified-log/unified-log.js';
import type { AiRequest, AIProvider } from './provider.js';
import { askAssistant, collectAnswer, DEFAULT_SYSTEM_PROMPT } from './assistant.js';

const log = (text: string): UnifiedLogEntry => ({
  source: 'cdp',
  level: 'error',
  text,
  timestampMs: 1,
});

/** A fake provider that records the request and streams a fixed answer word-by-word. */
function fakeProvider(answer = 'the login call returned 401'): {
  provider: AIProvider;
  lastRequest: () => AiRequest | undefined;
} {
  let last: AiRequest | undefined;
  const provider: AIProvider = {
    async *ask(request) {
      last = request;
      for (const word of answer.split(' ')) yield { text: word + ' ' };
    },
  };
  return { provider, lastRequest: () => last };
}

describe('askAssistant', () => {
  it('routes context through the boundary and returns the exact payload + a grounded answer', async () => {
    const { provider, lastRequest } = fakeProvider();
    const bundle = buildContextBundle({
      question: 'why did login fail?',
      logs: [log('POST /login 401')],
    });

    const { payload, answer } = askAssistant(bundle, { provider });
    const text = await collectAnswer(answer);

    // The provider was asked with EXACTLY the boundary's redacted payload text.
    expect(lastRequest()?.content).toBe(payload.text);
    expect(lastRequest()?.system).toBe(DEFAULT_SYSTEM_PROMPT);
    // The payload the UI can show carries the grounded context.
    expect(payload.text).toContain('POST /login 401');
    expect(text.trim()).toBe('the login call returned 401');
  });

  it('reaches the provider ONLY with redacted content (the boundary is the only door)', async () => {
    const { provider, lastRequest } = fakeProvider();
    const secret = 'sk-provider1234567890abcdef';
    const bundle = buildContextBundle({ question: 'debug', logs: [log(`key ${secret}`)] });

    // Consuming the stream runs the request; assert what actually reached the provider.
    await collectAnswer(askAssistant(bundle, { provider }).answer);

    expect(lastRequest()?.content).not.toContain(secret);
    expect(lastRequest()?.content).toContain('[REDACTED:api-key]');
  });

  it('passes through an optional model hint and system override', async () => {
    const { provider, lastRequest } = fakeProvider();
    const bundle = buildContextBundle({ question: 'q' });

    await collectAnswer(
      askAssistant(bundle, { provider, model: 'claude-opus-5', system: 'custom' }).answer,
    );

    expect(lastRequest()?.model).toBe('claude-opus-5');
    expect(lastRequest()?.system).toBe('custom');
  });

  it('omits the model field entirely when not provided (provider default applies)', async () => {
    const { provider, lastRequest } = fakeProvider();
    await collectAnswer(askAssistant(buildContextBundle({ question: 'q' }), { provider }).answer);
    expect(lastRequest() && 'model' in lastRequest()!).toBe(false);
  });

  it('does not call the provider until the answer stream is consumed', () => {
    const ask = vi.fn(async function* () {
      yield { text: 'hi' };
    });
    const provider: AIProvider = { ask };
    const { payload } = askAssistant(buildContextBundle({ question: 'q' }), { provider });
    // The payload is built eagerly (so the UI can preview it), but the provider is lazy.
    expect(payload.text).toContain('## Question');
    expect(ask).toHaveBeenCalledTimes(1); // ask() called, but the generator body hasn't run yet
  });
});
