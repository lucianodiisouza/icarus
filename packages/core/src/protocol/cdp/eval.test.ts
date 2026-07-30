import { describe, expect, it, vi } from 'vitest';
import { evaluateOnTarget, type CdpSendLike } from './eval.js';

/**
 * E-17: `Runtime.evaluate` wrapper tests. The hard rule: never throws — every
 * failure mode is a typed `EvaluateResult` variant.
 */

function makeSend(
  impl: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): CdpSendLike {
  return { send: impl as CdpSendLike['send'] };
}

describe('evaluateOnTarget — happy path', () => {
  it('returns the value with returnByValue default', async () => {
    const send = makeSend(async (m) => {
      expect(m).toBe('Runtime.evaluate');
      return { result: { value: { hello: 'world' } } };
    });
    const out = await evaluateOnTarget<{ hello: string }>(send, '({hello:"world"})');
    expect(out).toEqual({ ok: true, value: { hello: 'world' } });
  });

  it('forwards returnByValue: false to the CDP call', async () => {
    const spy = vi.fn(async () => ({ result: { objectId: 'obj-1' } }));
    const send: CdpSendLike = { send: spy as CdpSendLike['send'] };
    await evaluateOnTarget(send, '1+1', { returnByValue: false });
    expect(spy).toHaveBeenCalledWith(
      'Runtime.evaluate',
      expect.objectContaining({ returnByValue: false, expression: '1+1' }),
    );
  });
});

describe('evaluateOnTarget — typed error paths', () => {
  it('a remote exception is surfaced as kind: remote_exception (not thrown)', async () => {
    const send = makeSend(async () => ({
      exceptionDetails: {
        exception: { className: 'TypeError', description: 'cannot read x' },
        text: 'TypeError: cannot read x',
      },
    }));
    const out = await evaluateOnTarget(send, 'throw new TypeError("x")');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    if (out.kind !== 'remote_exception') return;
    expect(out.name).toBe('TypeError');
    expect(out.message).toBe('cannot read x');
  });

  it('a CDP call rejection is surfaced as kind: cdp_error (not thrown)', async () => {
    const send = makeSend(async () => {
      throw new Error('No target with given id found');
    });
    const out = await evaluateOnTarget(send, '1+1');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    if (out.kind !== 'cdp_error') return;
    expect(out.message).toContain('No target');
  });

  it('a hang on the CDP call is surfaced as kind: timeout', async () => {
    const send: CdpSendLike = {
      send: () => new Promise(() => {}),
    };
    const start = Date.now();
    const out = await evaluateOnTarget(send, 'while(true){}', { timeoutMs: 25 });
    const elapsed = Date.now() - start;
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe('timeout');
    expect(elapsed).toBeLessThan(200);
  });
});

describe('evaluateOnTarget — return value edge cases', () => {
  it('a value-less result is returned as undefined (not thrown)', async () => {
    const send = makeSend(async () => ({ result: {} }));
    const out = await evaluateOnTarget(send, 'undefined');
    expect(out).toEqual({ ok: true, value: undefined });
  });
});
