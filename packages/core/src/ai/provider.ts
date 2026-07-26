/**
 * The swappable AI provider seam (E-13, T-13.1; ADR-0011). The assistant reaches a model
 * only through this narrow interface, so the concrete provider — BYOK-Claude first, a local
 * model later — is a dependency, not a hard-wired choice. Deliberately Electron-free and
 * **SDK-free**: `core` defines the contract; the Anthropic implementation (and the only
 * network egress) lives in the separate `@icarus/ai` package behind this interface.
 *
 * The interface is intentionally minimal — one streamed request/response. No tools, no
 * actions, no multi-step loop (NG-6): a provider answers, it never acts.
 */

export interface AiRequest {
  /** System prompt establishing the grounded-assistant role. */
  readonly system: string;
  /** The user-facing content — the redacted `SendPayload.text` (context + question). */
  readonly content: string;
  /** Optional model hint; the provider applies its own default (e.g. per ADR-0011) if absent. */
  readonly model?: string;
}

/** One streamed fragment of the answer. */
export interface AiChunk {
  readonly text: string;
}

export interface AIProvider {
  /** Ask the model and stream back the answer. Implementations must not perform any action. */
  ask(request: AiRequest): AsyncIterable<AiChunk>;
}
