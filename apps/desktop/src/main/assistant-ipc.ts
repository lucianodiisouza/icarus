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
  aiKeySetInputSchema,
  aiReviewInputSchema,
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
 * Register the assistant's key-lifecycle channels on the router (validated at the boundary). The
 * review/send pair is per-window (each holds a pending reviewed payload), so it's bound separately
 * via `bindAssistantReviewAndSend` — it needs the calling `webContents`.
 */
export function registerAssistantChannels(router: IpcRouter, assistant: AssistantBridge): void {
  router.register(CHANNELS.AI_KEY_STATUS, z.void(), (): Promise<AiKeyStatus> =>
    assistant.keyStatus(),
  );
  router.register(CHANNELS.AI_KEY_SET, aiKeySetInputSchema, ({ key }) => assistant.setKey(key));
  router.register(CHANNELS.AI_KEY_CLEAR, z.void(), () => assistant.clearKey());
}

/**
 * Bind the two-step consent-gated ask (E-12 T-12.5 / E-13). Both steps are per-window:
 *
 * - `AI_REVIEW` builds the exact redacted payload for a question and holds it as this window's
 *   pending payload, returning it for the user to review. It sends nothing and needs no key.
 * - `AI_SEND` sends that held payload — exactly what was reviewed, never re-derived from context
 *   that may have grown since — then streams the answer (`AI_CHUNK` → `AI_DONE`/`AI_ERROR`). The
 *   pending payload is consumed on send, so every send is backed by a fresh, explicit review.
 *
 * A `NoApiKeyError` on send rejects the invoke and emits `AI_ERROR { noKey: true }` so an
 * event-driven UI still learns of it. A new send cancels any in-flight one; a destroyed window
 * drops its pending payload and cancels its stream. Nothing leaves the machine without a key.
 */
export function bindAssistantReviewAndSend(assistant: AssistantBridge): void {
  /** This window's reviewed-but-not-yet-sent payload, keyed by `webContents.id`. */
  const pending = new Map<number, SendPayload>();
  /** In-flight answer streams, keyed by `webContents.id`; the flag stops a cancelled stream. */
  const inFlight = new Map<number, { cancelled: boolean }>();
  const cancel = (id: number): void => {
    const token = inFlight.get(id);
    if (token) token.cancelled = true;
    inFlight.delete(id);
  };

  ipcMain.handle(SUBSCRIPTIONS.AI_REVIEW, (event, rawInput: unknown): SendPayload => {
    const wc = event.sender;
    const payload = assistant.preview(aiReviewInputSchema.parse(rawInput));
    pending.set(wc.id, payload); // hold exactly these bytes for the matching send
    wc.once('destroyed', () => pending.delete(wc.id));
    return payload;
  });

  ipcMain.handle(SUBSCRIPTIONS.AI_SEND, async (event): Promise<SendPayload> => {
    const wc = event.sender;
    cancel(wc.id); // a new send supersedes any in-flight one for this window
    const payload = pending.get(wc.id);
    if (payload === undefined) throw new Error('Nothing to send — review a question first.');
    pending.delete(wc.id); // consume the consent: one review, one send

    let answer: AsyncIterable<{ text: string }>;
    try {
      answer = await assistant.send(payload);
    } catch (err) {
      send(wc, EVENTS.AI_ERROR, {
        message: errorMessage(err),
        noKey: err instanceof NoApiKeyError,
      });
      throw err; // reject the invoke too — the send never started
    }

    const token = { cancelled: false };
    inFlight.set(wc.id, token);
    wc.once('destroyed', () => cancel(wc.id));
    void streamAnswer(wc, answer, token, () => {
      if (inFlight.get(wc.id) === token) inFlight.delete(wc.id);
    });

    return payload;
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
