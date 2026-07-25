// @ts-check
// Phase 1 helper: find Metro inspector proxies and enumerate their CDP targets.
// Uses global fetch (Node >= 18). Zero dependencies.
import { DEFAULT_HOST, DEFAULT_METRO_PORTS } from "./ports.js";

/**
 * @typedef {Object} CdpTarget
 * @property {string} id
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [type]
 * @property {string} [webSocketDebuggerUrl]
 * @property {string} [deviceName]
 * @property {string} [reactNative]  // RN proxy adds metadata under vendor keys; kept loose on purpose
 */

/**
 * Query one Metro inspector proxy for its target list.
 * The RN inspector proxy is expected to answer /json/list (and /json). We try both.
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, port: number, endpoint?: string, targets?: CdpTarget[], error?: string }>}
 */
export async function queryProxy(host, port, timeoutMs = 1500) {
  const endpoints = [`http://${host}:${port}/json/list`, `http://${host}:${port}/json`];
  for (const endpoint of endpoints) {
    try {
      const res = await fetchWithTimeout(endpoint, timeoutMs);
      if (!res.ok) continue;
      const body = await res.json();
      if (Array.isArray(body)) {
        return { ok: true, port, endpoint, targets: body };
      }
    } catch (err) {
      // Connection refused / not a proxy on this port — try the next endpoint/port.
      const message = err instanceof Error ? err.message : String(err);
      // Remember the last error only if nothing else succeeds for this port.
      if (endpoint === endpoints[endpoints.length - 1]) {
        return { ok: false, port, error: message };
      }
    }
  }
  return { ok: false, port, error: "no target list at /json/list or /json" };
}

/**
 * Scan the default (or provided) ports for reachable inspector proxies.
 * @param {{ host?: string, ports?: number[] }} [opts]
 */
export async function discoverProxies(opts = {}) {
  const host = opts.host ?? DEFAULT_HOST;
  const ports = opts.ports ?? DEFAULT_METRO_PORTS;
  const results = await Promise.all(ports.map((p) => queryProxy(host, p)));
  return results.filter((r) => r.ok);
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
