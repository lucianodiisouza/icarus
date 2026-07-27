import { buildAiSendPayload, type SendPayload } from './boundary/send-payload.js';
import type { ContextBundle } from './boundary/context-bundle.js';
import type { AIProvider, AiChunk } from './provider.js';

/**
 * The grounded assistant orchestrator (E-13, T-13.4). It is the one place that turns a
 * question-plus-context into a model call, and it does so through exactly one door:
 * `buildAiSendPayload` (the E-12 boundary). There is no path here that reaches a provider
 * with un-redacted context, and there is no tool/action surface — it asks and streams the
 * answer, nothing else (NG-6).
 *
 * It returns the **exact `SendPayload` it used** alongside the answer stream, so the UI can
 * show "what this answer was grounded on" and prove the answer came from captured context
 * (G-6), not from data the user pasted.
 */

/** The default grounding contract handed to every provider. */
export const DEFAULT_SYSTEM_PROMPT =
  "You are Icarus's debugging assistant for a React Native developer. Answer the developer's " +
  'question using ONLY the captured debug context provided below (logs and network activity). ' +
  'If the context does not contain enough to answer, say so plainly — do not invent details. ' +
  'You cannot take actions; you only explain what the context shows.';

export interface AskAssistantDeps {
  readonly provider: AIProvider;
  /** Override the grounding system prompt (defaults to `DEFAULT_SYSTEM_PROMPT`). */
  readonly system?: string;
  /** Optional model hint passed to the provider. */
  readonly model?: string;
}

export interface AssistantExchange {
  /** Exactly what was sent to the model — redacted, with the redaction report. */
  readonly payload: SendPayload;
  /** The streamed, grounded answer. */
  readonly answer: AsyncIterable<AiChunk>;
}

/**
 * Assemble the redacted payload from a context bundle and ask the provider. Returns the
 * payload (for the "what was sent" surface) and the answer stream together, guaranteeing the
 * streamed answer was grounded on exactly that payload.
 */
export function askAssistant(bundle: ContextBundle, deps: AskAssistantDeps): AssistantExchange {
  const payload = buildAiSendPayload(bundle); // the ONLY door to a provider
  return { payload, answer: askWithPayload(payload, deps) };
}

/**
 * Ask the provider with an **already-built** payload — the consent-gated send path (E-12 T-12.5).
 * This adds no new door to a provider: a `SendPayload` can only be produced by `buildAiSendPayload`
 * (the boundary), so deferring its send to after the user approves it changes *when* it's sent,
 * never *what*. That's what lets the user review the exact redacted bytes and then send those same
 * bytes — the send can't silently pick up context captured after the review.
 */
export function askWithPayload(
  payload: SendPayload,
  deps: AskAssistantDeps,
): AsyncIterable<AiChunk> {
  return deps.provider.ask({
    system: deps.system ?? DEFAULT_SYSTEM_PROMPT,
    content: payload.text,
    ...(deps.model !== undefined ? { model: deps.model } : {}),
  });
}

/** Collect a streamed answer into a single string (for non-streaming callers and tests). */
export async function collectAnswer(answer: AsyncIterable<AiChunk>): Promise<string> {
  let text = '';
  for await (const chunk of answer) text += chunk.text;
  return text;
}
