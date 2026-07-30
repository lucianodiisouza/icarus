import { describe, expect, it } from 'vitest';
import { createStorageController, registerStorageChannels } from './storage-controller.js';
import type { CdpSendLike } from '@icarus/core';
import { IpcRouter } from './ipc/router.js';
import { CHANNELS } from '../shared/ipc/contracts.js';

/**
 * E-18 storage controller tests. The hard rules:
 *   - the controller is the only thing the IPC channels talk to
 *   - the three channels (list / get / delete) all forward to the core
 *     `listStorage` / `getStorageValue` / `deleteStorageKey` wrappers
 *   - the controller's setCdpSend updates the live send (the channels
 *     pick it up via the closure)
 *   - the typed results flow through unchanged — no type erasure at the
 *     IPC boundary
 */

function makeSend(
  impl: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): CdpSendLike {
  return { send: impl as CdpSendLike['send'] };
}

describe('createStorageController — basic shape', () => {
  it('starts with no CDP send (list returns not_connected)', async () => {
    const c = createStorageController();
    const out = await c.list('async-storage');
    expect(out).toEqual({ ok: false, kind: 'not_connected' });
  });

  it('setCdpSend wires the send into the next list call', async () => {
    const c = createStorageController();
    c.setCdpSend(
      makeSend(async () => ({
        result: { value: { ok: true, keys: [{ key: 'k', preview: '"v"', kind: 'string' }] } },
      })),
    );
    const out = await c.list('async-storage');
    expect(out).toEqual({
      ok: true,
      keys: [{ key: 'k', preview: '"v"', kind: 'string' }],
    });
  });

  it('setCdpSend(null) disables the next call (back to not_connected)', async () => {
    const c = createStorageController();
    c.setCdpSend(makeSend(async () => ({})));
    c.setCdpSend(null);
    const out = await c.list('mmkv');
    expect(out).toEqual({ ok: false, kind: 'not_connected' });
  });
});

describe('createStorageController — get', () => {
  it('returns not_connected when no CDP send is set', async () => {
    const c = createStorageController();
    const out = await c.get('async-storage', 'k');
    expect(out).toEqual({ ok: false, kind: 'not_connected' });
  });

  it('forwards the value on a successful expression', async () => {
    const c = createStorageController();
    c.setCdpSend(
      makeSend(async () => ({
        result: { value: { ok: true, value: '"hello"', valueKind: 'string' } },
      })),
    );
    const out = await c.get('async-storage', 'k');
    expect(out).toEqual({ ok: true, value: { value: '"hello"', kind: 'string' } });
  });

  it('propagates a no_key from the expression', async () => {
    const c = createStorageController();
    c.setCdpSend(makeSend(async () => ({ result: { value: { ok: false, kind: 'no_key' } } })));
    const out = await c.get('mmkv', 'missing');
    expect(out).toEqual({ ok: false, kind: 'no_key' });
  });
});

describe('createStorageController — delete', () => {
  it('returns not_connected when no CDP send is set', async () => {
    const c = createStorageController();
    const out = await c.delete('async-storage', 'k');
    expect(out).toEqual({ ok: false, kind: 'not_connected' });
  });

  it('forwards a successful delete', async () => {
    const c = createStorageController();
    c.setCdpSend(makeSend(async () => ({ result: { value: { ok: true } } })));
    const out = await c.delete('async-storage', 'k');
    expect(out).toEqual({ ok: true });
  });

  it('propagates a no_module failure from the expression', async () => {
    const c = createStorageController();
    c.setCdpSend(makeSend(async () => ({ result: { value: { ok: false, kind: 'no_module' } } })));
    const out = await c.delete('mmkv', 'k');
    expect(out).toEqual({ ok: false, kind: 'no_module' });
  });
});

describe('registerStorageChannels — IPC wiring', () => {
  it('list channel returns the typed snapshot', async () => {
    const c = createStorageController();
    c.setCdpSend(
      makeSend(async () => ({
        result: { value: { ok: true, keys: [{ key: 'k', preview: '1', kind: 'number' }] } },
      })),
    );
    const router = new IpcRouter();
    registerStorageChannels({ router, controller: c });
    const out = (await router.dispatch(CHANNELS.STORAGE_LIST, { backend: 'async-storage' })) as {
      ok: boolean;
    };
    expect(out.ok).toBe(true);
  });

  it('get channel returns the typed value', async () => {
    const c = createStorageController();
    c.setCdpSend(
      makeSend(async () => ({
        result: { value: { ok: true, value: '"v"', valueKind: 'string' } },
      })),
    );
    const router = new IpcRouter();
    registerStorageChannels({ router, controller: c });
    const out = (await router.dispatch(CHANNELS.STORAGE_GET, {
      backend: 'async-storage',
      key: 'k',
    })) as { ok: boolean; value?: { value: string } };
    expect(out.ok).toBe(true);
    expect(out.value?.value).toBe('"v"');
  });

  it('delete channel forwards the call', async () => {
    const c = createStorageController();
    c.setCdpSend(makeSend(async () => ({ result: { value: { ok: true } } })));
    const router = new IpcRouter();
    registerStorageChannels({ router, controller: c });
    const out = await router.dispatch(CHANNELS.STORAGE_DELETE, {
      backend: 'async-storage',
      key: 'k',
    });
    expect(out).toEqual({ ok: true });
  });

  it('rejects an unknown backend', async () => {
    const c = createStorageController();
    const router = new IpcRouter();
    registerStorageChannels({ router, controller: c });
    await expect(router.dispatch(CHANNELS.STORAGE_LIST, { backend: 'sqlite' })).rejects.toThrow(
      /invalid input/i,
    );
  });
});
