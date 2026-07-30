import { describe, expect, it } from 'vitest';
import { createNavController, registerNavChannels } from './nav-controller.js';
import type { CdpSendLike } from '@icarus/core';
import { IpcRouter } from './ipc/router.js';
import { CHANNELS } from '../shared/ipc/contracts.js';

/**
 * E-20 navigation controller tests. The hard rules:
 *   - disconnected → not_connected (no thrown error)
 *   - the app can install the bridge via globalThis.__ICARUS_NAV_STATE__; missing → no_bridge
 *   - the typed result flows through the IPC channel unchanged
 */

function makeSend(
  impl: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): CdpSendLike {
  return { send: impl as CdpSendLike['send'] };
}

describe('createNavController — disconnected', () => {
  it('returns not_connected when no CDP send is set', async () => {
    const c = createNavController();
    const out = await c.snapshot();
    expect(out).toEqual({ ok: false, kind: 'not_connected' });
  });
});

describe('createNavController — happy path', () => {
  it('returns a typed snapshot when the app has installed the bridge', async () => {
    const c = createNavController();
    c.setCdpSend(
      makeSend(async () => ({
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
      })),
    );
    const out = await c.snapshot();
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.activeRouteName).toBe('Home');
  });

  it('returns no_bridge when the app has not installed the bridge', async () => {
    const c = createNavController();
    c.setCdpSend(makeSend(async () => ({ result: { value: { ok: false, kind: 'no_bridge' } } })));
    const out = await c.snapshot();
    expect(out).toEqual({ ok: false, kind: 'no_bridge' });
  });
});

describe('registerNavChannels — IPC wiring', () => {
  it('routes the snapshot channel to the controller', async () => {
    const c = createNavController();
    c.setCdpSend(
      makeSend(async () => ({
        result: {
          value: {
            ok: true,
            state: {
              index: 1,
              routeNames: ['A', 'B'],
              routes: [
                { name: 'A', key: 'a-1' },
                { name: 'B', key: 'b-1' },
              ],
            },
          },
        },
      })),
    );
    const router = new IpcRouter();
    registerNavChannels({ router, controller: c });
    const out = (await router.dispatch(CHANNELS.NAV_SNAPSHOT, undefined)) as {
      ok: boolean;
      state?: { activeRouteName: string };
    };
    expect(out.ok).toBe(true);
    expect(out.state?.activeRouteName).toBe('B');
  });

  it('returns a typed not-connected snapshot via the IPC channel', async () => {
    const c = createNavController();
    const router = new IpcRouter();
    registerNavChannels({ router, controller: c });
    const out = await router.dispatch(CHANNELS.NAV_SNAPSHOT, undefined);
    expect(out).toEqual({ ok: false, kind: 'not_connected' });
  });
});
