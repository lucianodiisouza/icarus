import {
  askWithPayload,
  buildAiSendPayload,
  buildContextBundle,
  type AIProvider,
  type AiChunk,
  type CdpNetworkEvent,
  type KeyStore,
  type SendPayload,
  type UnifiedLogEntry,
} from '@icarus/core';

/**
 * The main-process orchestration behind the AI assistant (E-13, T-13.5). It is the one place
 * the desktop turns a question + the live debug context into a model call — always through
 * the E-12 boundary (`buildAiSendPayload`). It owns the BYOK key lifecycle and streams the
 * grounded answer. Kept UI-free and injectable so it's unit-testable without Electron or a
 * network: the key store, the provider factory, and the context snapshots are all injected.
 */

export interface AssistantOptions {
  readonly question: string;
  /** Category toggles (T-12.6): default both on. `undefined` is treated as the default. */
  readonly includeLogs?: boolean | undefined;
  readonly includeNetwork?: boolean | undefined;
}

export interface KeyStatus {
  /** A key is stored and decryptable on this machine. */
  readonly hasKey: boolean;
  /** The OS keychain is available to store one (else the user can't enable AI here). */
  readonly secureStorageAvailable: boolean;
}

export interface AssistantBridgeDeps {
  readonly keyStore: KeyStore;
  /** Whether OS-backed secure storage is usable (Electron `safeStorage`). */
  readonly secureStorageAvailable: () => boolean;
  /** Build a provider from the user's key (the `@icarus/ai` Anthropic provider in prod). */
  readonly makeProvider: (apiKey: string) => AIProvider;
  /** Snapshot of the recent unified log (from the live stream). */
  readonly logSnapshot: () => readonly UnifiedLogEntry[];
  /** Snapshot of recent network events. */
  readonly networkSnapshot: () => readonly CdpNetworkEvent[];
}

/** Raised by `ask` when no usable key is configured — the UI shows the "add a key" state. */
export class NoApiKeyError extends Error {
  constructor() {
    super('No API key configured; the assistant is disabled.');
    this.name = 'NoApiKeyError';
  }
}

export class AssistantBridge {
  constructor(private readonly deps: AssistantBridgeDeps) {}

  async keyStatus(): Promise<KeyStatus> {
    const key = await this.deps.keyStore.get();
    return { hasKey: key !== null, secureStorageAvailable: this.deps.secureStorageAvailable() };
  }

  /** Store the BYOK key (encrypted). Throws if secure storage is unavailable. */
  async setKey(key: string): Promise<void> {
    await this.deps.keyStore.set(key);
  }

  async clearKey(): Promise<void> {
    await this.deps.keyStore.clear();
  }

  /**
   * The exact redacted payload that *would* be sent for this question — the reviewable "what gets
   * sent" bytes the user approves before any send (T-12.5). Pure over the boundary; needs no key
   * and sends nothing. The caller holds the returned payload and hands it back to `send`, so the
   * user sends exactly what they reviewed — not context captured after the review.
   */
  preview(options: AssistantOptions): SendPayload {
    return buildAiSendPayload(this.#bundle(options));
  }

  /**
   * Send an already-reviewed payload to the provider and stream the grounded answer (T-12.5). The
   * payload must be one produced by `preview` — this is the consent-gated send. Throws
   * `NoApiKeyError` if no key is set (e.g. cleared between review and send).
   */
  async send(payload: SendPayload): Promise<AsyncIterable<AiChunk>> {
    const key = await this.deps.keyStore.get();
    if (key === null) throw new NoApiKeyError();
    return askWithPayload(payload, { provider: this.deps.makeProvider(key) });
  }

  #bundle(options: AssistantOptions) {
    return buildContextBundle(
      {
        question: options.question,
        logs: this.deps.logSnapshot(),
        network: this.deps.networkSnapshot(),
      },
      {
        includeLogs: options.includeLogs ?? true,
        includeNetwork: options.includeNetwork ?? true,
      },
    );
  }
}
