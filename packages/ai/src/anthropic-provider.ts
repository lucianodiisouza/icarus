import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, AiChunk, AiRequest } from '@icarus/core';

/**
 * The Anthropic (Claude) implementation of `@icarus/core`'s swappable `AIProvider`
 * (E-13, T-13.2; ADR-0011). This is the one place the `@anthropic-ai/sdk` and the only
 * network egress live — kept out of the Electron-free `core` and behind the interface, so
 * a future local provider slots in without touching the assistant.
 *
 * BYOK: the request goes directly from the user's machine to Anthropic with the user's own
 * key. Icarus runs no backend and holds no key beyond what the caller passes in.
 */

/** ADR-0011's interactive default; `claude-opus-5` is the deeper-reasoning option. */
export const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicProviderOptions {
  /** The user's Anthropic API key (BYOK). */
  readonly apiKey: string;
  /** Model id; defaults to `claude-sonnet-5` (configurable, not architectural). */
  readonly defaultModel?: string;
  /** Max output tokens per answer. */
  readonly maxTokens?: number;
  /** Inject a client for tests; defaults to a real `Anthropic` client built from `apiKey`. */
  readonly client?: AnthropicLike;
}

/** The minimal slice of the Anthropic client this provider depends on — a streamed message. */
export interface AnthropicLike {
  readonly messages: {
    stream(body: {
      model: string;
      max_tokens: number;
      system: string;
      messages: ReadonlyArray<{ role: 'user'; content: string }>;
    }): AsyncIterable<StreamEvent>;
  };
}

/** The stream events we consume — text deltas of the answer. */
interface StreamEvent {
  readonly type: string;
  readonly delta?: { readonly type: string; readonly text?: string };
}

/**
 * Build an `AIProvider` backed by Claude. `ask` streams the answer as `AiChunk`s; only
 * `content_block_delta` text deltas are surfaced (thinking/other blocks are ignored). No
 * tools, no actions (NG-6) — it answers and streams.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): AIProvider {
  const client: AnthropicLike =
    options.client ?? (new Anthropic({ apiKey: options.apiKey }) as unknown as AnthropicLike);
  const defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    async *ask(request: AiRequest): AsyncIterable<AiChunk> {
      const stream = client.messages.stream({
        model: request.model ?? defaultModel,
        max_tokens: maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.content }],
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const text = event.delta.text;
          if (text) yield { text };
        }
      }
    },
  };
}
