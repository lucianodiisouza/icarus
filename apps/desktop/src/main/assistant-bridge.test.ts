import { describe, expect, it, vi } from 'vitest';
import type { AIProvider, KeyStore, UnifiedLogEntry } from '@icarus/core';
import { collectAnswer } from '@icarus/core';
import { AssistantBridge, NoApiKeyError, type AssistantBridgeDeps } from './assistant-bridge.js';

const log = (text: string): UnifiedLogEntry => ({
  source: 'cdp',
  level: 'error',
  text,
  timestampMs: 1,
});

/** A KeyStore fake backed by an in-memory value. */
function fakeKeyStore(initial: string | null = null): KeyStore {
  let key = initial;
  return {
    get: () => Promise.resolve(key),
    set: (k) => {
      key = k;
      return Promise.resolve();
    },
    clear: () => {
      key = null;
      return Promise.resolve();
    },
  };
}

/** A provider that echoes the content back so tests can assert what was sent. */
function echoProvider(): { provider: AIProvider; lastContent: () => string | undefined } {
  let content: string | undefined;
  const provider: AIProvider = {
    async *ask(req) {
      content = req.content;
      yield { text: 'answer' };
    },
  };
  return { provider, lastContent: () => content };
}

function makeBridge(over: Partial<AssistantBridgeDeps> = {}): AssistantBridge {
  const deps: AssistantBridgeDeps = {
    keyStore: fakeKeyStore(),
    secureStorageAvailable: () => true,
    makeProvider: () => ({
      async *ask() {
        yield { text: 'x' };
      },
    }),
    logSnapshot: () => [],
    networkSnapshot: () => [],
    ...over,
  };
  return new AssistantBridge(deps);
}

describe('AssistantBridge', () => {
  it('reports key status (present/absent + secure storage availability)', async () => {
    expect(await makeBridge().keyStatus()).toEqual({ hasKey: false, secureStorageAvailable: true });
    expect(
      await makeBridge({
        keyStore: fakeKeyStore('sk-x'),
        secureStorageAvailable: () => false,
      }).keyStatus(),
    ).toEqual({ hasKey: true, secureStorageAvailable: false });
  });

  it('preview builds the redacted payload from the live context — no key, no send', () => {
    const bridge = makeBridge({
      logSnapshot: () => [log('token=sk-abcdefghijklmnop1234'), log('POST /login 401')],
    });
    const payload = bridge.preview({ question: 'why did login fail?' });

    expect(payload.text).toContain('why did login fail?');
    expect(payload.text).toContain('POST /login 401');
    expect(payload.text).not.toContain('sk-abcdefghijklmnop1234');
    expect(payload.report.byCategory['api-key']).toBe(1);
  });

  it('preview honors category toggles', () => {
    const bridge = makeBridge({
      logSnapshot: () => [log('a log line')],
      networkSnapshot: () => [
        { kind: 'request', requestId: '1', timestampMs: 1, url: 'https://x' },
      ],
    });
    const noLogs = bridge.preview({ question: 'q', includeLogs: false });
    expect(noLogs.text).not.toContain('a log line');
    expect(noLogs.text).toContain('Network');
  });

  it('send routes the reviewed payload through the boundary to the provider', async () => {
    const { provider, lastContent } = echoProvider();
    const bridge = makeBridge({
      keyStore: fakeKeyStore('sk-user-key'),
      makeProvider: () => provider,
      logSnapshot: () => [log('secret sk-abcdefghijklmnop1234 here')],
    });

    const payload = bridge.preview({ question: 'debug' });
    const text = await collectAnswer(await bridge.send(payload));

    expect(lastContent()).toBe(payload.text); // exactly the reviewed bytes were sent
    expect(lastContent()).not.toContain('sk-abcdefghijklmnop1234'); // redacted before it left
    expect(text).toBe('answer');
  });

  it('send builds the provider from the stored key', async () => {
    const makeProvider = vi.fn(() => echoProvider().provider);
    const bridge = makeBridge({ keyStore: fakeKeyStore('sk-THE-KEY'), makeProvider });
    await collectAnswer(await bridge.send(bridge.preview({ question: 'q' })));
    expect(makeProvider).toHaveBeenCalledWith('sk-THE-KEY');
  });

  it('send throws NoApiKeyError when no key is set (assistant stays disabled)', async () => {
    const bridge = makeBridge({ keyStore: fakeKeyStore(null) });
    await expect(bridge.send(bridge.preview({ question: 'q' }))).rejects.toThrow(NoApiKeyError);
  });

  it('setKey / clearKey delegate to the key store', async () => {
    const keyStore = fakeKeyStore();
    const bridge = makeBridge({ keyStore });
    await bridge.setKey('sk-new');
    expect(await keyStore.get()).toBe('sk-new');
    await bridge.clearKey();
    expect(await keyStore.get()).toBeNull();
  });
});
