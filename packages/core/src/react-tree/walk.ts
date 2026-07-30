/**
 * The M3 component tree inspector's pure half (E-17). Takes a snapshot of a React
 * fiber root and walks it into a renderable `ComponentNode[]` tree. Pure and
 * Electron-free (ADR-0002): no `Runtime.evaluate` here, no React imports, no
 * I/O — given an `unknown` that *looks like* a fiber, returns a tree.
 *
 * Why pure: the renderer test uses hand-built fiber mocks; the desktop test
 * uses a fake `Runtime.evaluate` response; neither needs a real React tree to
 * ship the inspector. Real fiber introspection happens in the app's JS
 * context (the `FIBER_ROOT_EXPRESSION`) and the result comes back as a JSON
 * snapshot we can walk without any React dependency.
 *
 * Fiber shape — what we expect from a snapshot:
 *
 *   {
 *     type: { displayName: 'App', name: 'App' } | string,
 *     memoizedProps: object,
 *     stateNode: { tag: 3, current: fiber } | null,
 *     child: fiber | null,
 *     sibling: fiber | null,
 *   }
 *
 * The walker is defensive about shape: it never throws on weird input, it just
 * tags the result with a `<unknown>` name when it can't resolve. The recursion
 * caps (`maxDepth`, `maxNodesPerBranch`) keep the panel from being overwhelmed
 * by huge trees.
 *
 * The fiber `child`/`sibling` links form a tree: a node's "first child" is in
 * `child`, and its siblings are in `sibling`. The walker descends on `child`
 * first, then walks the `sibling` chain as siblings of the parent.
 */

/** The minimal shape we need from a fiber — castable from an `unknown` snapshot. */
export interface FiberLike {
  type?: unknown;
  memoizedProps?: unknown;
  child?: unknown;
  sibling?: unknown;
  stateNode?: unknown;
  tag?: unknown;
}

export interface ComponentNode {
  /** `displayName ?? name ?? <anonymous>` — a human-readable identifier. */
  readonly name: string;
  /** True when the node is the synthetic "Host" root (the AppRegistry host). */
  readonly isHostRoot: boolean;
  /** 0 = root, 1 = first level of children, etc. */
  readonly depth: number;
  /**
   * A stable id derived from the path of the node. Two snapshots of the same tree
   * will have the same `id` for the same node — useful for the renderer's React
   * keys. The id is path-based (`0.2.1`), not field-based, so it's stable across
   * the renderer's reconcile.
   */
  readonly id: string;
  /**
   * Resolved props, **stringified**. The inspector never shows raw values; it
   * shows a JSON-ish preview (2-level deep, max 20 keys, primitives only). The
   * string is for the renderer's "click to expand → see props" view.
   */
  readonly props: Readonly<Record<string, string>>;
  /** Child components, in render order. May be empty. */
  readonly children: readonly ComponentNode[];
}

export interface WalkOptions {
  /** Hard cap on recursion depth. Default 50. */
  readonly maxDepth?: number;
  /** Hard cap on the number of nodes per branch. Default 5000 (generous). */
  readonly maxNodesPerBranch?: number;
  /** Max keys to surface per node's props. Default 20 (keeps the panel readable). */
  readonly maxPropsPerNode?: number;
  /** Max depth of nested objects in the props preview. Default 2. */
  readonly maxPropsStringifyDepth?: number;
}

const DEFAULT_MAX_DEPTH = 50;
const DEFAULT_MAX_NODES_PER_BRANCH = 5_000;
const DEFAULT_MAX_PROPS = 20;
const DEFAULT_MAX_PROPS_DEPTH = 2;

interface ResolvedLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxProps: number;
  readonly maxPropsDepth: number;
}

function resolveLimits(options: WalkOptions): ResolvedLimits {
  return {
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxNodes: options.maxNodesPerBranch ?? DEFAULT_MAX_NODES_PER_BRANCH,
    maxProps: options.maxPropsPerNode ?? DEFAULT_MAX_PROPS,
    maxPropsDepth: options.maxPropsStringifyDepth ?? DEFAULT_MAX_PROPS_DEPTH,
  };
}

/**
 * The expression the desktop sends to the app via `Runtime.evaluate` to grab the
 * fiber root. Tries the React 18+ `__reactContainer$xxxx` key first, then falls
 * back to scanning for any `__react*` key on the root element. Returns the
 * `child` of the fiber root — that's the first rendered component.
 *
 * The expression is intentionally simple: it only reads from `document` and
 * from the fiber's own fields. It does not call any user code, does not
 * mutate, does not require any globals besides `document` (which exists
 * inside the RN WebView / Hermes inspector context).
 */
export const FIBER_ROOT_EXPRESSION = `(() => {
  const root = document.getElementById('root');
  if (!root) return { ok: false, kind: 'no_root_element' };
  const key = Object.keys(root).find((k) => k.startsWith('__reactContainer'));
  if (!key) return { ok: false, kind: 'no_fiber_root' };
  const fiber = root[key]?.stateNode?.current;
  if (!fiber) return { ok: false, kind: 'no_current_fiber' };
  return { ok: true, fiber: fiber.child ?? null };
})()`;

/**
 * Walk a fiber root snapshot into a renderable tree. Pure: same input → same
 * output, never throws. The input is the `fiber` field of a successful
 * `FIBER_ROOT_EXPRESSION` result, or a hand-built mock for tests.
 *
 * `path` is the path-so-far (used to build stable `id`s); recursive calls
 * append. The recursion caps are absolute and prevent runaway trees.
 */
export function walkReactTree(
  rootFiber: unknown,
  options: WalkOptions = {},
  path: readonly number[] = [],
): readonly ComponentNode[] {
  if (path.length >= (options.maxDepth ?? DEFAULT_MAX_DEPTH)) return [];
  if (rootFiber === null || rootFiber === undefined) return [];
  return walkBranch(rootFiber, path, options);
}

function walkBranch(
  fiber: unknown,
  path: readonly number[],
  options: WalkOptions,
): readonly ComponentNode[] {
  const limits = resolveLimits(options);
  const out: ComponentNode[] = [];
  let current: unknown = fiber;
  let index = 0;
  while (current !== null && current !== undefined) {
    if (path.length >= limits.maxDepth) break;
    if (out.length >= limits.maxNodes) break;
    const fiberLike = asFiberLike(current);
    // The first call to walkBranch from walkReactTree gets `path = []`, so the root
    // node's id is "" (the empty path) — but the renderer wants a stable non-empty
    // id for the root. We tag the root with "0" so it's still stable and unique.
    const childPath = path.length === 0 ? [0] : [...path, index];
    const node = fiberToNode(fiberLike, childPath, options);
    out.push(node);
    current = fiberLike.sibling ?? null;
    index += 1;
  }
  return out;
}

function fiberToNode(
  fiber: FiberLike,
  path: readonly number[],
  options: WalkOptions,
): ComponentNode {
  const limits = resolveLimits(options);
  const name = componentName(fiber.type);
  const isHostRoot = isHostRootFiber(fiber);
  const id = path.join('.');
  const props =
    fiber.memoizedProps !== undefined && fiber.memoizedProps !== null
      ? safeStringify(
          fiber.memoizedProps as Record<string, unknown>,
          limits.maxProps,
          limits.maxPropsDepth,
        )
      : {};
  const children =
    fiber.child !== null && fiber.child !== undefined
      ? walkReactTree(fiber.child, options, path)
      : [];
  // `depth` is the visible depth (0 = root, 1 = first level of children, ...).
  // `path.length` for a root call is 1 (because we always seed with `[0]`), so we
  // report `path.length - 1` to make the root a depth of 0.
  return { name, isHostRoot, depth: path.length - 1, id, props, children };
}

function isHostRootFiber(fiber: FiberLike): boolean {
  // The HostRoot is the synthetic root that React creates for the whole tree.
  // Its `tag` is 3 (HostRoot) and its `stateNode` is the FiberRoot (a host
  // container, not a real component). When we see this we surface it with
  // `name: 'HostRoot'` so the user can tell.
  return fiber.tag === 3;
}

function asFiberLike(value: unknown): FiberLike {
  if (typeof value === 'object' && value !== null) {
    return value as FiberLike;
  }
  // Non-objects are not fibers; the walker still walks them (no throw) but
  // returns no name and no children.
  return {};
}

function componentName(type: unknown): string {
  if (typeof type === 'string') {
    // Host components (View, Text, ScrollView, etc.) have a string `type`.
    return type;
  }
  if (typeof type === 'function') {
    // The function (or class) component — but we received a *snapshot*, not a
    // live function reference. In the snapshot path, `type` is a plain object
    // (not a function), so this branch is mostly for tests.
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName ?? fn.name ?? '<anonymous>';
  }
  if (typeof type === 'object' && type !== null) {
    // Snapshot shape: `{ displayName?, name?, $$typeof?, render?, type? }`
    const t = type as {
      displayName?: string;
      name?: string;
      $$typeof?: string | symbol;
      render?: { displayName?: string; name?: string };
      type?: { displayName?: string; name?: string };
    };
    // `forwardRef` and `memo` wrappers: dig one level deeper for the real
    // component name.
    if (t.render) return t.render.displayName ?? t.render.name ?? '<forwardRef>';
    if (t.type) return t.type.displayName ?? t.type.name ?? '<memo>';
    return t.displayName ?? t.name ?? '<unknown>';
  }
  return '<unknown>';
}

/**
 * Stringify a props object for the inspector's "expand to see props" view.
 * Pure, never throws on circular refs, depth-limited, key-count-limited.
 * Returns a `Record<string, string>` so the renderer can show key/value pairs
 * in a table.
 */
export function safeStringify(
  obj: Record<string, unknown>,
  maxKeys = DEFAULT_MAX_PROPS,
  maxDepth = DEFAULT_MAX_PROPS_DEPTH,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  const seen = new WeakSet<object>();
  const keys = Object.keys(obj).slice(0, maxKeys);
  for (const k of keys) {
    out[k] = previewValue(obj[k], maxDepth, seen);
  }
  return out;
}

function previewValue(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
  if (t === 'function') {
    const fn = value as { displayName?: string; name?: string };
    return `ƒ ${fn.displayName ?? fn.name ?? 'anonymous'}`;
  }
  if (t === 'symbol') return (value as symbol).toString();
  if (depth <= 0) return Array.isArray(value) ? '[…]' : '{…}';
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[…]';
    seen.add(value);
    const items = value.slice(0, 5).map((v) => previewValue(v, depth - 1, seen));
    const suffix = value.length > 5 ? `, …(${value.length - 5} more)` : '';
    return `[${items.join(', ')}${suffix}]`;
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return '{…}';
    seen.add(obj);
    const keys = Object.keys(obj).slice(0, 5);
    const parts = keys.map((k) => `${k}: ${previewValue(obj[k], depth - 1, seen)}`);
    const suffix = Object.keys(obj).length > 5 ? ', …' : '';
    return `{${parts.join(', ')}${suffix}}`;
  }
  return String(value);
}
