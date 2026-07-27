import {
  askAssistant,
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
   * The exact redacted payload that *would* be sent for this question — for the "what gets
   * sent" surface (T-12.5). Pure over the boundary; needs no key and sends nothing.
   */
  preview(options: AssistantOptions): SendPayload {
    return buildAiSendPayload(this.#bundle(options));
  }

  /**
   * Ask the assistant: build the redacted payload, call the provider, and return the payload
   * (what was sent) plus the streamed answer. Throws `NoApiKeyError` when no key is set — the
   * boundary is still the only door to the provider.
   */
  async ask(
    options: AssistantOptions,
  ): Promise<{ payload: SendPayload; answer: AsyncIterable<AiChunk> }> {
    const key = await this.deps.keyStore.get();
    if (key === null) throw new NoApiKeyError();
    return askAssistant(this.#bundle(options), { provider: this.deps.makeProvider(key) });
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
