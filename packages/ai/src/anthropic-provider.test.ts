import { describe, expect, it, vi } from 'vitest';
import { collectAnswer } from '@icarus/core';
import type { AnthropicLike } from './anthropic-provider.js';
import { createAnthropicProvider, DEFAULT_MODEL } from './anthropic-provider.js';

/** Build a fake Anthropic client whose stream yields the given events; records the body. */
function fakeClient(events: unknown[]): {
  client: AnthropicLike;
  lastBody: () => Parameters<AnthropicLike['messages']['stream']>[0] | undefined;
} {
  let body: Parameters<AnthropicLike['messages']['stream']>[0] | undefined;
  const client: AnthropicLike = {
    messages: {
      stream(b) {
        body = b;
        return (async function* () {
          for (const e of events) yield e as never;
        })();
      },
    },
  };
  return { client, lastBody: () => body };
}

/** A text-delta stream event, as the Anthropic SDK emits. */
const textDelta = (text: string) => ({
  type: 'content_block_delta',
  delta: { type: 'text_delta', text },
});

describe('createAnthropicProvider', () => {
  it('streams only text deltas as AiChunks', async () => {
    const { client } = fakeClient([
      { type: 'message_start' },
      { type: 'content_block_start' },
      textDelta('the '),
      textDelta('login '),
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } }, // ignored
      textDelta('failed'),
      { type: 'message_stop' },
    ]);
    const provider = createAnthropicProvider({ apiKey: 'sk-test', client });

    const answer = await collectAnswer(
      provider.ask({ system: 'sys', content: 'why did login fail?' }),
    );

    expect(answer).toBe('the login failed');
  });

  it('sends the system prompt and content as a single user message, with the default model', async () => {
    const { client, lastBody } = fakeClient([textDelta('ok')]);
    const provider = createAnthropicProvider({ apiKey: 'sk-test', client });

    await collectAnswer(provider.ask({ system: 'you are grounded', content: 'the payload' }));

    expect(lastBody()).toMatchObject({
      model: DEFAULT_MODEL,
      system: 'you are grounded',
      messages: [{ role: 'user', content: 'the payload' }],
    });
    expect(lastBody()?.max_tokens).toBeGreaterThan(0);
  });

  it('honors a per-request model override, else the configured default', async () => {
    const { client, lastBody } = fakeClient([textDelta('x')]);
    const provider = createAnthropicProvider({
      apiKey: 'sk-test',
      client,
      defaultModel: 'claude-sonnet-5',
    });

    await collectAnswer(provider.ask({ system: 's', content: 'c', model: 'claude-opus-5' }));
    expect(lastBody()?.model).toBe('claude-opus-5');

    await collectAnswer(provider.ask({ system: 's', content: 'c' }));
    expect(lastBody()?.model).toBe('claude-sonnet-5');
  });

  it('applies a configurable max_tokens', async () => {
    const { client, lastBody } = fakeClient([textDelta('x')]);
    const provider = createAnthropicProvider({ apiKey: 'sk-test', client, maxTokens: 1234 });
    await collectAnswer(provider.ask({ system: 's', content: 'c' }));
    expect(lastBody()?.max_tokens).toBe(1234);
  });

  it('skips empty text deltas without yielding', async () => {
    const { client } = fakeClient([textDelta(''), textDelta('real')]);
    const provider = createAnthropicProvider({ apiKey: 'sk-test', client });
    const chunks: string[] = [];
    for await (const chunk of provider.ask({ system: 's', content: 'c' })) chunks.push(chunk.text);
    expect(chunks).toEqual(['real']);
  });

  it('does not open the stream until the answer is consumed', () => {
    const stream = vi.fn(() => (async function* () {})());
    const client: AnthropicLike = { messages: { stream } };
    const provider = createAnthropicProvider({ apiKey: 'sk-test', client });
    provider.ask({ system: 's', content: 'c' }); // not iterated
    expect(stream).not.toHaveBeenCalled();
  });
});
