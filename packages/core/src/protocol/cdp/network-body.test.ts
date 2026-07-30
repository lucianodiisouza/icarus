import { describe, expect, it, vi } from 'vitest';
import { fetchRequestBody, fetchResponseBody, type CdpSendLike } from './network-body.js';

/**
 * M3 network inspector (E-16, T-16.3) — body-fetch wrapper tests. The hard rules:
 *   - binary responses (base64Encoded) are skipped, not surfaced as garbled text
 *   - too-large bodies are skipped, not buffered into the panel
 *   - timeouts are surfaced as a typed `reason: 'timeout'`, not a thrown error
 *   - CDP errors surface as `'not-fetchable'`, not as raw messages
 */

function makeSend(
  impl: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): CdpSendLike {
  // Wrap the test impl so its return type matches the generic `send<R = unknown>`.
  // The cast is local to tests; production callers use the real `CdpClient.send`.
  const send = impl as CdpSendLike['send'];
  return { send };
}

describe('fetchRequestBody', () => {
  it('returns the postData on a happy path', async () => {
    const send = makeSend(async (m) => {
      expect(m).toBe('Network.getRequestPostData');
      return { postData: '{"email":"x@example.com"}' };
    });
    const out = await fetchRequestBody(send, 'r1');
    expect(out).toEqual({ body: '{"email":"x@example.com"}', skipped: false });
  });

  it('returns body: null when the request had no body', async () => {
    const send = makeSend(async () => ({ postData: '' }));
    const out = await fetchRequestBody(send, 'r1');
    expect(out).toEqual({ body: null, skipped: false });
  });

  it('skips bodies over the size cap with reason: too-large', async () => {
    const big = 'a'.repeat(1024);
    const send = makeSend(async () => ({ postData: big }));
    const out = await fetchRequestBody(send, 'r1', { maxBytes: 128 });
    expect(out).toEqual({ body: null, skipped: true, reason: 'too-large' });
  });

  it('surfaces a CDP error as reason: not-fetchable (no thrown error)', async () => {
    const send = makeSend(async () => {
      throw new Error('No data found for requestId r1');
    });
    const out = await fetchRequestBody(send, 'r1');
    expect(out).toEqual({ body: null, skipped: false, reason: 'not-fetchable' });
  });
});

describe('fetchResponseBody', () => {
  it('returns the body on a happy path', async () => {
    const send = makeSend(async (m) => {
      expect(m).toBe('Network.getResponseBody');
      return { body: '{"ok":true}', base64Encoded: false };
    });
    const out = await fetchResponseBody(send, 'r1');
    expect(out).toEqual({ body: '{"ok":true}', skipped: false });
  });

  it('skips binary bodies (base64-encoded) with reason: binary', async () => {
    const send = makeSend(async () => ({
      body: 'iVBORw0KGgo...',
      base64Encoded: true,
    }));
    const out = await fetchResponseBody(send, 'r1');
    expect(out).toEqual({ body: null, skipped: true, reason: 'binary' });
  });

  it('skips over-cap bodies with reason: too-large', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024); // 2 MB
    const send = makeSend(async () => ({ body: big, base64Encoded: false }));
    const out = await fetchResponseBody(send, 'r1');
    expect(out.reason).toBe('too-large');
    expect(out.body).toBeNull();
  });

  it('surfaces a CDP error as reason: not-fetchable', async () => {
    const send = makeSend(async () => {
      throw new Error('No data found');
    });
    const out = await fetchResponseBody(send, 'r1');
    expect(out).toEqual({ body: null, skipped: false, reason: 'not-fetchable' });
  });
});

describe('fetchRequestBody / fetchResponseBody — timeouts', () => {
  it('time out with reason: timeout when the CDP call hangs', async () => {
    const send: CdpSendLike = {
      send: () => new Promise(() => {}), // never resolves
    };
    const start = Date.now();
    const out = await fetchRequestBody(send, 'r1', { timeoutMs: 25 });
    const elapsed = Date.now() - start;
    expect(out.reason).toBe('timeout');
    expect(out.body).toBeNull();
    expect(elapsed).toBeLessThan(200); // genuinely timed out, didn't hang
  });
});

describe('fetchRequestBody — the call is forwarded with the right requestId', () => {
  it('forwards requestId in the params', async () => {
    const spy = vi.fn(async () => ({ postData: 'ok' }));
    const send: CdpSendLike = { send: spy as CdpSendLike['send'] };
    await fetchRequestBody(send, 'the-id-42');
    expect(spy).toHaveBeenCalledWith('Network.getRequestPostData', { requestId: 'the-id-42' });
  });
});
