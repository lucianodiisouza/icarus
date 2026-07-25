import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { IpcError, IpcRouter } from './router.js';

describe('IpcRouter', () => {
  it('dispatches to a registered handler with validated input', async () => {
    const router = new IpcRouter();
    router.register(
      'command:add',
      z.object({ a: z.number(), b: z.number() }),
      async ({ a, b }) => a + b,
    );

    const result = await router.dispatch('command:add', { a: 2, b: 3 });

    expect(result).toBe(5);
    expect(router.channels()).toEqual(['command:add']);
  });

  it('rejects an unknown channel', async () => {
    const router = new IpcRouter();
    await expect(router.dispatch('query:nope', undefined)).rejects.toMatchObject({
      code: 'unknown_channel',
      channel: 'query:nope',
    });
  });

  it('rejects invalid input before calling the handler', async () => {
    const router = new IpcRouter();
    let called = false;
    router.register('command:echo', z.object({ message: z.string().min(1) }), async (input) => {
      called = true;
      return input;
    });

    await expect(router.dispatch('command:echo', { message: '' })).rejects.toBeInstanceOf(IpcError);
    await expect(router.dispatch('command:echo', { message: '' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(called).toBe(false);
  });

  it('wraps a throwing handler as handler_error (no raw leak)', async () => {
    const router = new IpcRouter();
    router.register('command:boom', z.void(), async () => {
      throw new Error('secret internal detail');
    });

    await expect(router.dispatch('command:boom', undefined)).rejects.toMatchObject({
      code: 'handler_error',
      channel: 'command:boom',
    });
  });

  it('refuses to register the same channel twice', () => {
    const router = new IpcRouter();
    router.register('q', z.void(), async () => null);
    expect(() => router.register('q', z.void(), async () => null)).toThrow(IpcError);
  });
});
