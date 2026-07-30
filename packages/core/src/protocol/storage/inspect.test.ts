import { describe, expect, it } from 'vitest';
import { deleteStorageKey, getStorageValue, listStorage } from './inspect.js';
import {
  storageDeleteExpression,
  storageGetExpression,
  storageListExpression,
} from './expressions.js';
import type { CdpSendLike } from '../cdp/eval.js';

/**
 * E-18 storage inspector tests. The hard rules:
 *   - the JS expression is shape-correct: it always returns either { ok: true, ... }
 *     or { ok: false, kind: 'no_module' | 'no_key' | ... }
 *   - the inspector never throws — every failure is a typed result
 *   - the inspector handles a disconnected CDP send
 */

function makeSend(
  impl: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): CdpSendLike {
  return { send: impl as CdpSendLike['send'] };
}

describe('storageListExpression — shape', () => {
  it('is a self-invoking IIFE that uses Runtime.evaluate-friendly syntax', () => {
    const expr = storageListExpression('async-storage');
    expect(typeof expr).toBe('string');
    expect(expr).toContain('resolveAsyncStorage');
    expect(expr).toContain('require(');
  });

  it('uses the MMKV path when backend is mmkv', () => {
    const expr = storageListExpression('mmkv');
    expect(expr).toContain('resolveMmkv');
  });
});

describe('storageGetExpression — key substitution', () => {
  it('embeds the key as a JSON string literal (no free variables)', () => {
    const expr = storageGetExpression('async-storage', 'user:42');
    // The key shows up as a quoted string literal, not as `KEY` (the free
    // variable inside the IIFE).
    expect(expr).toContain('"user:42"');
    expect(expr).toContain('const KEY');
  });

  it('escapes quotes / backslashes in the key (no JS injection)', () => {
    const expr = storageGetExpression('mmkv', 'weird"key\\with\nnewlines');
    // JSON.stringify will escape the embedded characters safely.
    expect(expr).toContain('"weird\\"key\\\\with\\nnewlines"');
  });
});

describe('storageDeleteExpression — same shape', () => {
  it('embeds the key as a JSON literal', () => {
    const expr = storageDeleteExpression('async-storage', 'temp:cache');
    expect(expr).toContain('"temp:cache"');
  });
});

describe('listStorage — disconnected', () => {
  it('returns not_connected when cdp is null', async () => {
    const out = await listStorage(null, 'async-storage');
    expect(out).toEqual({ ok: false, kind: 'not_connected' });
  });
});

describe('listStorage — happy paths', () => {
  it('returns the typed keys on a successful expression', async () => {
    const cdp = makeSend(async () => ({
      result: {
        value: {
          ok: true,
          keys: [
            { key: 'theme', preview: '"dark"', kind: 'string' },
            { key: 'count', preview: '7', kind: 'number' },
            { key: 'flags', preview: '{"a":1,"b":2}', kind: 'object' },
          ],
        },
      },
    }));
    const out = await listStorage(cdp, 'async-storage');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.keys).toEqual([
      { key: 'theme', preview: '"dark"', kind: 'string' },
      { key: 'count', preview: '7', kind: 'number' },
      { key: 'flags', preview: '{"a":1,"b":2}', kind: 'object' },
    ]);
  });

  it('coerces an unknown kind to "unknown" (defensive)', async () => {
    const cdp = makeSend(async () => ({
      result: { value: { ok: true, keys: [{ key: 'x', preview: '?', kind: 'gibberish' }] } },
    }));
    const out = await listStorage(cdp, 'async-storage');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.keys[0]?.kind).toBe('unknown');
  });

  it('returns ok: true with an empty list when the store is empty', async () => {
    const cdp = makeSend(async () => ({ result: { value: { ok: true, keys: [] } } }));
    const out = await listStorage(cdp, 'mmkv');
    expect(out).toEqual({ ok: true, keys: [] });
  });
});

describe('listStorage — typed failure paths', () => {
  it('a no_module result from the expression is propagated', async () => {
    const cdp = makeSend(async () => ({
      result: { value: { ok: false, kind: 'no_module' } },
    }));
    const out = await listStorage(cdp, 'async-storage');
    expect(out).toEqual({ ok: false, kind: 'no_module' });
  });

  it('a null/undefined expression result becomes no_module (defensive)', async () => {
    const cdp = makeSend(async () => ({ result: { value: null } }));
    const out = await listStorage(cdp, 'async-storage');
    expect(out).toEqual({ ok: false, kind: 'no_module' });
  });

  it('a remote exception is typed as remote_exception (no throw)', async () => {
    const cdp = makeSend(async () => ({
      exceptionDetails: { exception: { className: 'Error', description: 'oops' }, text: 'oops' },
    }));
    const out = await listStorage(cdp, 'async-storage');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    if (out.kind !== 'remote_exception') return;
    expect(out.message).toBe('oops');
  });

  it('a CDP call rejection is typed as cdp_error (no throw)', async () => {
    const cdp = makeSend(async () => {
      throw new Error('protocol boom');
    });
    const out = await listStorage(cdp, 'mmkv');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    if (out.kind !== 'cdp_error') return;
    expect(out.message).toContain('protocol');
  });
});

describe('getStorageValue — disconnected + not_connected', () => {
  it('returns not_connected when cdp is null', async () => {
    const out = await getStorageValue(null, 'async-storage', 'k');
    expect(out).toEqual({ ok: false, kind: 'not_connected' });
  });
});

describe('getStorageValue — happy path', () => {
  it('returns the value on a successful expression', async () => {
    const cdp = makeSend(async () => ({
      result: { value: { ok: true, value: '"hello"', valueKind: 'string' } },
    }));
    const out = await getStorageValue(cdp, 'async-storage', 'k');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toEqual({ value: '"hello"', kind: 'string' });
  });

  it('a no_key result is propagated (the expression returned no_key)', async () => {
    const cdp = makeSend(async () => ({
      result: { value: { ok: false, kind: 'no_key' } },
    }));
    const out = await getStorageValue(cdp, 'mmkv', 'missing');
    expect(out).toEqual({ ok: false, kind: 'no_key' });
  });

  it('a no_module result is propagated', async () => {
    const cdp = makeSend(async () => ({
      result: { value: { ok: false, kind: 'no_module' } },
    }));
    const out = await getStorageValue(cdp, 'async-storage', 'k');
    expect(out).toEqual({ ok: false, kind: 'no_module' });
  });
});

describe('deleteStorageKey — happy + failure paths', () => {
  it('returns ok: true on a successful expression', async () => {
    const cdp = makeSend(async () => ({ result: { value: { ok: true } } }));
    const out = await deleteStorageKey(cdp, 'async-storage', 'k');
    expect(out).toEqual({ ok: true });
  });

  it('a no_module result is propagated', async () => {
    const cdp = makeSend(async () => ({
      result: { value: { ok: false, kind: 'no_module' } },
    }));
    const out = await deleteStorageKey(cdp, 'mmkv', 'k');
    expect(out).toEqual({ ok: false, kind: 'no_module' });
  });

  it('a CDP error is typed as cdp_error (no throw)', async () => {
    const cdp = makeSend(async () => {
      throw new Error('synthetic');
    });
    const out = await deleteStorageKey(cdp, 'async-storage', 'k');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe('cdp_error');
  });
});
