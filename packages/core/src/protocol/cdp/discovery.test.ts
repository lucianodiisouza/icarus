import { describe, expect, it } from 'vitest';
import { discoverProxies } from './discovery.js';
import type { FetchLike } from './types.js';

const ok = (body: unknown): Awaited<ReturnType<FetchLike>> => ({
  ok: true,
  json: async () => body,
});

describe('discoverProxies', () => {
  it('returns proxies whose /json/list yields a target array', async () => {
    const targets = [{ id: 't1', webSocketDebuggerUrl: 'ws://localhost:8081/x' }];
    const fetch: FetchLike = async (url) => {
      if (url === 'http://localhost:8081/json/list') return ok(targets);
      throw new Error('ECONNREFUSED');
    };

    const found = await discoverProxies({ ports: [8081, 8082], fetch });

    expect(found).toHaveLength(1);
    expect(found[0]?.port).toBe(8081);
    expect(found[0]?.endpoint).toBe('http://localhost:8081/json/list');
    expect(found[0]?.targets).toEqual(targets);
  });

  it('falls back to /json when /json/list is unavailable', async () => {
    const fetch: FetchLike = async (url) => {
      if (url.endsWith('/json/list')) throw new Error('404');
      if (url.endsWith('/json')) return ok([{ id: 'a' }]);
      throw new Error('nope');
    };
    const found = await discoverProxies({ ports: [8081], fetch });
    expect(found[0]?.endpoint).toBe('http://localhost:8081/json');
  });

  it('returns empty when nothing is reachable', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await discoverProxies({ ports: [8081, 19000], fetch })).toEqual([]);
  });

  it('ignores non-array bodies', async () => {
    const fetch: FetchLike = async () => ok({ not: 'an array' });
    expect(await discoverProxies({ ports: [8081], fetch })).toEqual([]);
  });
});
