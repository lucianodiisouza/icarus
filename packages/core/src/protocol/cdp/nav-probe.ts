/**
 * The M3 navigation inspector's probe (E-20). A small walker that turns a raw
 * React Navigation state (read from `globalThis.__ICARUS_NAV_STATE__`) into a
 * typed `NavStateSnapshot` for the inspector.
 *
 * The app-side bridge is one line:
 *   globalThis.__ICARUS_NAV_STATE__ = JSON.parse(JSON.stringify(nav.getState()));
 * ...which strips functions and cycles, leaving a JSON-serializable snapshot.
 * The walker is defensive: any unexpected shape is reported as `invalid_format`.
 *
 * Pure: never throws.
 */

export interface NavRoute {
  readonly name: string;
  readonly key: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface NavStateSnapshot {
  readonly type: 'react-navigation';
  readonly index: number;
  readonly routeNames: readonly string[];
  readonly routes: readonly NavRoute[];
  readonly activeRouteName: string;
}

export type NavProbe =
  | { readonly ok: true; readonly state: NavStateSnapshot }
  | { readonly ok: false; readonly kind: 'invalid_format'; readonly reason: string };

/** The IIFE the desktop ships to the app. Reads `globalThis.__ICARUS_NAV_STATE__`
 *  and returns it verbatim (the app is responsible for JSON-serializing it; the
 *  walker is purely a defensive type-narrower). */
export const NAV_PROBE = `(() => {
  const state = globalThis.__ICARUS_NAV_STATE__;
  if (!state) return { ok: false, kind: 'no_bridge' };
  return { ok: true, state };
})()`;

/**
 * Pure walker: turn a raw state object into a typed `NavStateSnapshot`. Defensive
 * on shape — never throws. Returns a typed error if the shape is unexpected.
 */
export function walkNavState(raw: unknown): NavProbe {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return { ok: false, kind: 'invalid_format', reason: 'state is not an object' };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.routes) || !Array.isArray(obj.routeNames)) {
    return { ok: false, kind: 'invalid_format', reason: 'missing routes / routeNames' };
  }
  const routes: NavRoute[] = [];
  for (const r of obj.routes) {
    if (r === null || typeof r !== 'object') {
      return { ok: false, kind: 'invalid_format', reason: 'route is not an object' };
    }
    const route = r as Record<string, unknown>;
    if (typeof route.name !== 'string' || typeof route.key !== 'string') {
      return { ok: false, kind: 'invalid_format', reason: 'route missing name / key' };
    }
    routes.push({
      name: route.name,
      key: route.key,
      ...(route.params !== undefined && route.params !== null
        ? { params: route.params as Record<string, unknown> }
        : {}),
    });
  }
  const routeNames = obj.routeNames.filter((n): n is string => typeof n === 'string');
  if (routeNames.length !== routes.length) {
    return {
      ok: false,
      kind: 'invalid_format',
      reason: 'routeNames length does not match routes',
    };
  }
  const idx = typeof obj.index === 'number' ? obj.index : routes.length - 1;
  if (idx < 0 || idx >= routes.length) {
    return { ok: false, kind: 'invalid_format', reason: 'index out of bounds' };
  }
  const activeRouteName = routes[idx]?.name ?? '<unknown>';
  return {
    ok: true,
    state: { type: 'react-navigation', index: idx, routeNames, routes, activeRouteName },
  };
}

/**
 * Param-to-string preview, for the renderer's "params" view. Primitives + small
 * objects only. Mirrors the E-17 `safeStringify` approach (key-count-capped,
 * depth-limited) so a route with a giant `params` blob doesn't blow up the panel.
 */
export function previewParams(
  params: Record<string, unknown> | undefined,
  maxKeys = 10,
): Readonly<Record<string, string>> {
  if (params === undefined) return {};
  const out: Record<string, string> = {};
  const keys = Object.keys(params).slice(0, maxKeys);
  for (const k of keys) {
    out[k] = previewValue(params[k]);
  }
  return out;
}

function previewValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t === 'string') return JSON.stringify(v);
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
  if (t === 'function') {
    const fn = v as { displayName?: string; name?: string };
    return `ƒ ${fn.displayName ?? fn.name ?? 'anonymous'}`;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
