import type { CdpTarget, FetchLike, ProxyDiscovery } from './types.js';

/**
 * Metro inspector-proxy discovery (E-14). Default ports observed in the spike: 8081
 * (Metro), 8082+ (extra instances), 19000-19002 (Expo). The target list is served
 * unauthenticated at `/json/list` (and `/json`).
 */
export const DEFAULT_METRO_PORTS: readonly number[] = [8081, 8082, 19000, 19001, 19002];
export const DEFAULT_HOST = 'localhost';

export interface DiscoverOptions {
  readonly host?: string;
  readonly ports?: readonly number[];
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

/** Query one proxy for its target list; resolves null if none is reachable there. */
export async function queryProxy(
  host: string,
  port: number,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<ProxyDiscovery | null> {
  for (const path of ['/json/list', '/json']) {
    const endpoint = `http://${host}:${port}${path}`;
    try {
      const res = await withTimeout(fetchImpl, endpoint, timeoutMs);
      if (!res.ok) continue;
      const body = await res.json();
      if (Array.isArray(body)) {
        return { host, port, endpoint, targets: body as CdpTarget[] };
      }
    } catch {
      // connection refused / not a proxy on this port — try next path/port
    }
  }
  return null;
}

/** Scan the given (or default) ports for reachable inspector proxies. */
export async function discoverProxies(options: DiscoverOptions = {}): Promise<ProxyDiscovery[]> {
  const host = options.host ?? DEFAULT_HOST;
  const ports = options.ports ?? DEFAULT_METRO_PORTS;
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = options.timeoutMs ?? 1500;
  if (!fetchImpl)
    throw new Error('No fetch implementation available; inject one via options.fetch');

  const results = await Promise.all(ports.map((p) => queryProxy(host, p, fetchImpl, timeoutMs)));
  return results.filter((r): r is ProxyDiscovery => r !== null);
}

async function withTimeout(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; json: () => Promise<unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
