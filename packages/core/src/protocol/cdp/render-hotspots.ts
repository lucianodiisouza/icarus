/**
 * The M3 performance inspector's render-hotspot probe (E-19). A small JS
 * IIFE that, when shipped to the running app via `Runtime.evaluate`, walks the
 * current fiber tree and reports per-component render counts.
 *
 * Heuristic: count the number of distinct `memoizedProps` objects along each
 * fiber's `current` + `alternate` chain. This is a stable proxy for "how
 * many times did this component re-render" — not perfect, but cheap and
 * doesn't require any app-side instrumentation.
 *
 * Why a probe, not a real hook: a real hook would require patching every
 * `useState` / `useReducer` call in the app's code. A probe that reads from
 * the fiber tree is opt-in and per-invocation — the inspector runs it on
 * click.
 *
 * The shape this expression returns is `RenderHotspotProbe`:
 *   { ok: true, hotspots: [{ name, renders }] }
 *   { ok: false, kind: 'no_fiber_root' | '...' }
 */

export interface RenderHotspot {
  readonly name: string;
  readonly renders: number;
}

export type RenderHotspotProbe =
  | { readonly ok: true; readonly hotspots: readonly RenderHotspot[] }
  | {
      readonly ok: false;
      readonly kind: 'no_fiber_root' | 'remote_exception' | 'timeout' | 'cdp_error';
      readonly message?: string;
    };

/** The IIFE the desktop ships to the app via `evaluateOnTarget`. */
export const RENDER_HOTSPOT_PROBE = `(() => {
  // Walk to a fiber root.
  function findRoot() {
    const root = document.getElementById('root');
    if (!root) return null;
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer'));
    if (!key) return null;
    return root[key]?.stateNode?.current ?? null;
  }
  function componentName(type) {
    if (typeof type === 'string') return type;
    if (type === null || type === undefined) return '<unknown>';
    if (typeof type === 'object') {
      if (type.render) return type.render.displayName ?? type.render.name ?? '<forwardRef>';
      if (type.type) return type.type.displayName ?? type.type.name ?? '<memo>';
      return type.displayName ?? type.name ?? '<unknown>';
    }
    return '<unknown>';
  }
  function isHostRoot(fiber) {
    return fiber?.tag === 3;
  }
  const root = findRoot();
  if (!root) return { ok: false, kind: 'no_fiber_root' };
  const counts = new Map();
  const visit = (fiber) => {
    if (fiber === null || fiber === undefined) return;
    if (isHostRoot(fiber)) {
      visit(fiber.child);
      return;
    }
    const name = componentName(fiber.type);
    let renders = 0;
    const seen = new Set();
    let cursor = fiber;
    let safety = 0;
    while (cursor !== null && cursor !== undefined && safety < 1000) {
      const p = cursor.memoizedProps;
      if (p !== null && p !== undefined) {
        if (!seen.has(p)) {
          seen.add(p);
          renders += 1;
        }
      }
      cursor = cursor.alternate;
      safety += 1;
    }
    counts.set(name, (counts.get(name) ?? 0) + renders);
    visit(fiber.child);
    visit(fiber.sibling);
  };
  visit(root.child);
  // Sort descending by renders; return top 20.
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    ok: true,
    hotspots: sorted.slice(0, 20).map(([name, renders]) => ({ name, renders })),
  };
})()`;
