import { describe, expect, it } from 'vitest';
import { FIBER_ROOT_EXPRESSION, safeStringify, walkReactTree } from './walk.js';
import type { FiberLike } from './walk.js';

/**
 * E-17 component tree walker tests. The walker is pure — every test here uses
 * hand-built fiber mocks, no React, no DOM, no Electron. The canary: a hand-
 * built tree with two siblings of the same parent must come out as two
 * `ComponentNode`s in the right order with stable path-based ids.
 */

/** A test helper: build a fiber-like object. */
function fiber(over: Partial<FiberLike> & { type: unknown }): FiberLike {
  return { ...over };
}

/** A host component fiber (e.g. `<View>`, `<Text>`). */
function host(
  type: string,
  props: Record<string, unknown> = {},
  children: FiberLike[] = [],
): FiberLike {
  const f: FiberLike = fiber({ type, memoizedProps: props });
  if (children.length === 0) return f;
  // Link children: first child is `child`, the rest are `sibling`s of the first.
  // We cast through a mutable bag so the noUncheckedIndexedAccess narrowing doesn't
  // make the test helper ugly; the test mocks don't need to be strictly typed.
  const bag = f as { child?: FiberLike };
  const first = children[0];
  if (first !== undefined) bag.child = first;
  for (let i = 0; i < children.length - 1; i++) {
    const cur = children[i];
    const next = children[i + 1];
    if (cur !== undefined && next !== undefined) {
      (cur as { sibling: FiberLike }).sibling = next;
    }
  }
  return f;
}

describe('walkReactTree — single-node tree', () => {
  it('returns one node for a single host component with no children', () => {
    const root = host('View', { style: { color: 'red' } });
    const out = walkReactTree(root);
    expect(out).toHaveLength(1);
    // `depth` is the position in the path array — 0-indexed, with the root at 0.
    expect(out[0]).toMatchObject({ name: 'View', isHostRoot: false, depth: 0, id: '0' });
    expect(out[0]?.props.style).toBe('{color: "red"}');
  });

  it('returns an empty list for null / undefined', () => {
    expect(walkReactTree(null)).toEqual([]);
    expect(walkReactTree(undefined)).toEqual([]);
  });
});

describe('walkReactTree — hierarchical tree', () => {
  it('walks child + sibling + nested children correctly', () => {
    // <App>
    //   <Header />
    //   <Body>
    //     <Title />
    //     <Subtitle />
    //   </Body>
    // </App>
    const root = host('App', {}, [
      host('Header', { title: 'hi' }),
      host('Body', {}, [host('Title', {}), host('Subtitle', {})]),
    ]);
    const out = walkReactTree(root);
    expect(out).toHaveLength(1);
    const app = out[0]!;
    expect(app.name).toBe('App');
    expect(app.children).toHaveLength(2);
    expect(app.children[0]?.name).toBe('Header');
    expect(app.children[1]?.name).toBe('Body');
    expect(app.children[1]?.children).toHaveLength(2);
    expect(app.children[1]?.children[0]?.name).toBe('Title');
    expect(app.children[1]?.children[1]?.name).toBe('Subtitle');
  });

  it('assigns stable path-based ids (0, 0.1, 0.1.0, ...)', () => {
    const root = host('App', {}, [host('Body', {}, [host('Title')])]);
    const out = walkReactTree(root);
    expect(out[0]?.id).toBe('0');
    expect(out[0]?.children[0]?.id).toBe('0.0');
    expect(out[0]?.children[0]?.children[0]?.id).toBe('0.0.0');
  });
});

describe('walkReactTree — component name resolution', () => {
  it('host components get their string name', () => {
    const out = walkReactTree(host('View'));
    expect(out[0]?.name).toBe('View');
  });

  it('function components get displayName or name', () => {
    const root = fiber({ type: { displayName: 'LoginForm', name: 'login' } });
    expect(walkReactTree(root)[0]?.name).toBe('LoginForm');
  });

  it('forwardRef components dig into the render type', () => {
    const root = fiber({
      type: { $$typeof: Symbol.for('react.forward_ref'), render: { displayName: 'FancyInput' } },
    });
    expect(walkReactTree(root)[0]?.name).toBe('FancyInput');
  });

  it('memo components dig into the wrapped type', () => {
    const root = fiber({
      type: { $$typeof: Symbol.for('react.memo'), type: { displayName: 'MemoizedRow' } },
    });
    expect(walkReactTree(root)[0]?.name).toBe('MemoizedRow');
  });

  it('a fiber with no type is named <unknown> (no throw)', () => {
    const out = walkReactTree(fiber({ type: undefined }));
    expect(out[0]?.name).toBe('<unknown>');
  });
});

describe('walkReactTree — HostRoot detection', () => {
  it('flags the synthetic root with isHostRoot: true', () => {
    const root: FiberLike = { tag: 3, type: undefined, child: host('App') };
    (root as { child: FiberLike }).child = host('App');
    const out = walkReactTree(root);
    expect(out[0]?.isHostRoot).toBe(true);
    expect(out[0]?.children).toHaveLength(1);
    expect(out[0]?.children[0]?.name).toBe('App');
    expect(out[0]?.children[0]?.isHostRoot).toBe(false);
  });
});

describe('walkReactTree — recursion caps', () => {
  it('maxDepth caps the depth', () => {
    // Build a deeply nested chain: each level has the next as a child.
    let deepest: FiberLike = host('Deepest');
    for (let i = 0; i < 100; i++) {
      const parent: FiberLike = host(`Level${i}`, {}, [deepest]);
      deepest = parent;
    }
    const out = walkReactTree(deepest, { maxDepth: 5 });
    // 5 levels deep → 5 nodes, then a leaf with no children
    expect(out).toHaveLength(1);
    let cur: { children: readonly { name: string; children: readonly unknown[] }[] } = out[0]!;
    let levels = 1;
    while (cur.children.length > 0) {
      cur = cur.children[0] as {
        children: readonly { name: string; children: readonly unknown[] }[];
      };
      levels += 1;
    }
    expect(levels).toBe(5);
  });

  it('maxNodesPerBranch caps the total node count', () => {
    // A wide tree: one root with 1000 sibling children.
    const children: FiberLike[] = [];
    for (let i = 0; i < 1000; i++) children.push(host(`Child${i}`));
    const root = host('App', {}, children);
    const out = walkReactTree(root, { maxNodesPerBranch: 50 });
    // 1 root + 50 children = 51 total
    const totalCount = (nodes: readonly { children: readonly unknown[] }[]): number =>
      nodes.reduce(
        (sum, n) => sum + 1 + totalCount(n.children as readonly { children: readonly unknown[] }[]),
        0,
      );
    expect(totalCount(out)).toBeLessThanOrEqual(51);
  });
});

describe('safeStringify — props preview', () => {
  it('renders primitives', () => {
    expect(safeStringify({ a: 1, b: 'x', c: true, d: null })).toEqual({
      a: '1',
      b: '"x"',
      c: 'true',
      d: 'null',
    });
  });

  it('renders nested objects up to maxDepth and falls back to {…} beyond', () => {
    const out = safeStringify({ a: { b: { c: { d: 1 } } } }, 10, 2);
    expect(out.a).toBe('{b: {c: {…}}}');
  });

  it('handles circular references without throwing', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a['self'] = a;
    expect(() => safeStringify(a)).not.toThrow();
    const out = safeStringify(a);
    expect(out.name).toBe('"a"');
    // The inner ref IS `a` itself; once we recurse into it, the second pass hits
    // the `seen` set and returns `{…}`. The outer string is a top-level call
    // and starts with a fresh `seen`, so the outer container is rendered.
    expect(out.self).toBe('{name: "a", self: {…}}');
  });

  it('caps the number of keys to maxKeys', () => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) obj[`k${i}`] = i;
    const out = safeStringify(obj, 5, 2);
    expect(Object.keys(out)).toHaveLength(5);
  });

  it('renders arrays up to 5 entries, then a tail summary', () => {
    const out = safeStringify({ xs: [1, 2, 3, 4, 5, 6, 7] });
    expect(out.xs).toBe('[1, 2, 3, 4, 5, …(2 more)]');
  });
});

describe('FIBER_ROOT_EXPRESSION', () => {
  it('is a non-empty string the inspector ships to Runtime.evaluate', () => {
    expect(typeof FIBER_ROOT_EXPRESSION).toBe('string');
    expect(FIBER_ROOT_EXPRESSION.length).toBeGreaterThan(20);
    // It must not call any user code — just read `document` and walk fiber keys.
    expect(FIBER_ROOT_EXPRESSION).toContain('document.getElementById');
    expect(FIBER_ROOT_EXPRESSION).toContain('__reactContainer');
  });
});
