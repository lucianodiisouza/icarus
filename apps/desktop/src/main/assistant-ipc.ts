import { join } from 'node:path';
import { ipcMain, safeStorage, type WebContents } from 'electron';
import { z } from 'zod';
import {
  EncryptedKeyStore,
  RingBuffer,
  fileStore,
  type CdpNetworkEvent,
  type UnifiedLogEntry,
} from '@icarus/core';
import { createAnthropicProvider } from '@icarus/ai';
import {
  CHANNELS,
  EVENTS,
  SUBSCRIPTIONS,
  aiAskInputSchema,
  aiKeySetInputSchema,
  aiPreviewInputSchema,
  type AiKeyStatus,
  type SendPayload,
} from '../shared/ipc/contracts.js';
import type { IpcRouter } from './ipc/router.js';
import { AssistantBridge, NoApiKeyError } from './assistant-bridge.js';
import { safeStorageEncryptor } from './safe-storage-encryptor.js';

/**
 * The desktop wiring of the AI assistant (E-13, T-13.5). Kept out of `index.ts` so the main entry
 * stays a thin orchestrator: this constructs the `AssistantBridge` from OS-backed primitives and
 * owns its query/command channels + the per-window ask stream. Nothing here talks to a model
 * directly — every path goes through the bridge, the one door to the E-12 boundary and provider.
 */

export interface AssistantWiring {
  readonly assistant: AssistantBridge;
  /** Feed a live CDP network event into the assistant's bounded context buffer (E-13). */
  readonly captureNetworkEvent: (event: CdpNetworkEvent) => void;
}

/**
 * Build the assistant bridge from real desktop primitives: an OS-encrypted BYOK key store
 * (`safeStorage`, never plaintext), the `@icarus/ai` Anthropic provider (the only network egress),
 * and bounded in-memory snapshots of the recent log + network for context. The log snapshot is
 * injected (it lives on the app's log stream); the network buffer is owned here and fed via the
 * returned `captureNetworkEvent`.
 */
export function createAssistant(deps: {
  readonly userDataPath: string;
  readonly logSnapshot: () => readonly UnifiedLogEntry[];
}): AssistantWiring {
  const networkBuffer = new RingBuffer<CdpNetworkEvent>(200);
  const assistant = new AssistantBridge({
    keyStore: new EncryptedKeyStore(
      safeStorageEncryptor,
      fileStore(join(deps.userDataPath, 'ai-key.enc')),
    ),
    secureStorageAvailable: () => safeStorage.isEncryptionAvailable(),
    makeProvider: (apiKey) => createAnthropicProvider({ apiKey }),
    logSnapshot: deps.logSnapshot,
    networkSnapshot: () => networkBuffer.snapshot(),
  });
  return { assistant, captureNetworkEvent: (event) => networkBuffer.push(event) };
}

/**
 * Register the assistant's query/command channels on the router (validated at the boundary):
 * the BYOK key lifecycle and the "what gets sent" preview. The streaming `ai.ask` is per-window,
 * so it's bound separately via `bindAssistantAsk` (it needs the calling `webContents`).
 */
export function registerAssistantChannels(router: IpcRouter, assistant: AssistantBridge): void {
  router.register(CHANNELS.AI_KEY_STATUS, z.void(), (): Promise<AiKeyStatus> =>
    assistant.keyStatus(),
  );
  router.register(CHANNELS.AI_KEY_SET, aiKeySetInputSchema, ({ key }) => assistant.setKey(key));
  router.register(CHANNELS.AI_KEY_CLEAR, z.void(), () => assistant.clearKey());
  router.register(CHANNELS.AI_PREVIEW, aiPreviewInputSchema, (input): Promise<SendPayload> =>
    Promise.resolve(assistant.preview(input)),
  );
}

/**
 * Bind the assistant ask stream (E-13). Like the unified-log subscription it's per-window:
 * `invoke` resolves with the exact redacted `SendPayload` that was sent (the "what was sent"
 * surface), then the answer streams as `AI_CHUNK` events, ending in `AI_DONE` or `AI_ERROR`.
 * A `NoApiKeyError` rejects the invoke and emits `AI_ERROR { noKey: true }` so a purely
 * event-driven UI still learns of it. A new ask from a window supersedes any in-flight one;
 * a destroyed window cancels its own. Nothing leaves the machine without a key.
 */
export function bindAssistantAsk(assistant: AssistantBridge): void {
  /** In-flight answer streams, keyed by `webContents.id`; the flag stops a cancelled stream. */
  const inFlight = new Map<number, { cancelled: boolean }>();
  const cancel = (id: number): void => {
    const token = inFlight.get(id);
    if (token) token.cancelled = true;
    inFlight.delete(id);
  };

  ipcMain.handle(SUBSCRIPTIONS.AI_ASK, async (event, rawInput: unknown): Promise<SendPayload> => {
    const wc = event.sender;
    cancel(wc.id); // a new ask supersedes any in-flight one for this window
    const input = aiAskInputSchema.parse(rawInput);

    let exchange;
    try {
      exchange = await assistant.ask(input);
    } catch (err) {
      send(wc, EVENTS.AI_ERROR, {
        message: errorMessage(err),
        noKey: err instanceof NoApiKeyError,
      });
      throw err; // reject the invoke too — the ask never started
    }

    const token = { cancelled: false };
    inFlight.set(wc.id, token);
    wc.once('destroyed', () => cancel(wc.id));
    void streamAnswer(wc, exchange.answer, token, () => {
      if (inFlight.get(wc.id) === token) inFlight.delete(wc.id);
    });

    return exchange.payload;
  });
}

async function streamAnswer(
  wc: WebContents,
  answer: AsyncIterable<{ text: string }>,
  token: { cancelled: boolean },
  onSettled: () => void,
): Promise<void> {
  try {
    for await (const chunk of answer) {
      if (token.cancelled || wc.isDestroyed()) return;
      wc.send(EVENTS.AI_CHUNK, { text: chunk.text });
    }
    if (!token.cancelled && !wc.isDestroyed()) wc.send(EVENTS.AI_DONE);
  } catch (err) {
    if (!token.cancelled && !wc.isDestroyed()) {
      wc.send(EVENTS.AI_ERROR, { message: errorMessage(err), noKey: false });
    }
  } finally {
    onSettled();
  }
}

function send(wc: WebContents, channel: string, payload: unknown): void {
  if (!wc.isDestroyed()) wc.send(channel, payload);
}

/** The message of an unknown thrown value, without leaking a stack to the renderer. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
