import { describe, expect, it } from 'vitest';
import { walkNavState, previewParams } from './nav-probe.js';
import { takeNavSnapshot } from './nav-snapshot.js';
import type { CdpSendLike } from './network-body.js';

/**
 * E-20 navigation inspector tests. The hard rules:
 *   - the walker turns a raw React Navigation state into a typed snapshot
 *   - the walker never throws on weird shapes; it returns invalid_format
 *   - the snapshot is composed from one CDP call (read globalThis.__ICARUS_NAV_STATE__)
 *   - disconnected → not_connected; missing → no_bridge; malformed → invalid_format
 */

function makeSend(
  impl: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): CdpSendLike {
  return { send: impl as CdpSendLike['send'] };
}

describe('walkNavState — happy path', () => {
  it('returns a typed snapshot on a 2-route stack', () => {
    const out = walkNavState({
      index: 1,
      routeNames: ['Home', 'Detail'],
      routes: [
        { name: 'Home', key: 'home-1', params: undefined },
        { name: 'Detail', key: 'detail-1', params: { id: '42' } },
      ],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.activeRouteName).toBe('Detail');
    expect(out.state.index).toBe(1);
    expect(out.state.routeNames).toEqual(['Home', 'Detail']);
    expect(out.state.routes).toHaveLength(2);
  });

  it('handles a single-route stack', () => {
    const out = walkNavState({
      index: 0,
      routeNames: ['Root'],
      routes: [{ name: 'Root', key: 'root-1' }],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.activeRouteName).toBe('Root');
  });
});

describe('walkNavState — defensive paths', () => {
  it('returns invalid_format when routes is missing', () => {
    const out = walkNavState({ routeNames: [] });
    expect(out).toEqual({
      ok: false,
      kind: 'invalid_format',
      reason: 'missing routes / routeNames',
    });
  });

  it('returns invalid_format when a route is missing name / key', () => {
    const out = walkNavState({
      index: 0,
      routeNames: ['Root'],
      routes: [{ key: 'root-1' }],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe('invalid_format');
  });

  it('returns invalid_format when the index is out of bounds', () => {
    const out = walkNavState({
      index: 5,
      routeNames: ['Root'],
      routes: [{ name: 'Root', key: 'root-1' }],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe('invalid_format');
  });

  it('returns invalid_format when routeNames length does not match routes', () => {
    const out = walkNavState({
      index: 0,
      routeNames: ['A', 'B'],
      routes: [{ name: 'A', key: 'a-1' }],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe('invalid_format');
  });

  it('never throws on null / undefined / non-object input', () => {
    expect(() => walkNavState(null)).not.toThrow();
    expect(() => walkNavState(undefined)).not.toThrow();
    expect(() => walkNavState(42)).not.toThrow();
    expect(() => walkNavState('oops')).not.toThrow();
  });
});

describe('previewParams — small projection', () => {
  it('renders primitives', () => {
    expect(previewParams({ id: '42', count: 7, ok: true })).toEqual({
      id: '"42"',
      count: '7',
      ok: 'true',
    });
  });

  it('handles a nested object via JSON.stringify', () => {
    const out = previewParams({ filter: { a: 1 } });
    expect(out.filter).toBe('{"a":1}');
  });

  it('returns an empty object for undefined params', () => {
    expect(previewParams(undefined)).toEqual({});
  });

  it('caps the key count', () => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) obj[`k${i}`] = i;
    expect(Object.keys(previewParams(obj, 3))).toHaveLength(3);
  });
});

describe('takeNavSnapshot — disconnected', () => {
  it('returns not_connected when cdp is null', async () => {
    const out = await takeNavSnapshot(null);
    expect(out).toEqual({ ok: false, kind: 'not_connected' });
  });
});

describe('takeNavSnapshot — happy paths', () => {
  it('returns a typed snapshot when the app has published the bridge', async () => {
    const cdp = makeSend(async () => ({
      result: {
        value: {
          ok: true,
          state: {
            index: 0,
            routeNames: ['Home'],
            routes: [{ name: 'Home', key: 'home-1' }],
          },
        },
      },
    }));
    const out = await takeNavSnapshot(cdp);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.activeRouteName).toBe('Home');
  });

  it('returns no_bridge when the app has not installed the bridge', async () => {
    const cdp = makeSend(async () => ({
      result: { value: { ok: false, kind: 'no_bridge' } },
    }));
    const out = await takeNavSnapshot(cdp);
    expect(out).toEqual({ ok: false, kind: 'no_bridge' });
  });
});

describe('takeNavSnapshot — typed failure paths', () => {
  it('returns invalid_format when the state is malformed', async () => {
    const cdp = makeSend(async () => ({
      result: { value: { ok: true, state: { no_routes: 'oops' } } },
    }));
    const out = await takeNavSnapshot(cdp);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    if (out.kind !== 'invalid_format') return;
    expect(out.reason).toContain('missing');
  });

  it('a CDP error is typed as cdp_error (no throw)', async () => {
    const cdp = makeSend(async () => {
      throw new Error('synthetic');
    });
    const out = await takeNavSnapshot(cdp);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe('cdp_error');
  });

  it('a remote exception is typed as remote_exception (no throw)', async () => {
    const cdp = makeSend(async () => ({
      exceptionDetails: { exception: { className: 'Error', description: 'oops' }, text: 'oops' },
    }));
    const out = await takeNavSnapshot(cdp);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe('remote_exception');
  });
});
