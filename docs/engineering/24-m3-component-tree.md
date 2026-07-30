# 24 — M3 Slice 3: Component Tree Inspector (E-17)

- **Milestone:** [M3+ — Additive Integrations](../planning/07-milestones.md).
- **What it delivers:** A real **React component tree inspector** — a hierarchical
  view of the currently-rendered components in the running RN app, with **name search**
  and **expand-to-see-props** interaction. The biggest "missing from Flipper" pain
  and the second-most-asked-for inspector.
- **Why this slice next:** the data flow is already in place (CDP session is live,
  `Runtime.evaluate` is a one-liner away). The shape of the work is identical to E-15
  / E-16: a pure `core` piece (the tree walker), a thin IPC wiring, a renderer panel.

> Sizes: **S ≤ ½ day · M 1–2 days · L 3–5 days**. `core` stays Electron-free (ADR-0002,
> lint-enforced). The CDP round-trip lives in `core/protocol/cdp/eval.ts`; the tree
> walker is a separate pure function in `core`.

---

## Goal

A hierarchical React component tree panel: expandable nodes with the component's
displayName, the rendered children, and (when expanded) the resolved props. A search
box highlights matching nodes by name. The renderer-side panel uses the existing
E-11 virtualization pattern (only the visible window is rendered).

## Design contract

```
// core (pure, Electron-free) — given a JS-side snapshot of a fiber root, walks the tree.
walkReactTree(rootFiberLike: unknown, options: WalkOptions): ComponentNode[]
type ComponentNode = {
  readonly name: string;          // displayName or function name
  readonly id: string;            // stable id (path-based), for the renderer's key
  readonly depth: number;
  readonly props: Readonly<Record<string, string>>; // stringified (JSON.stringify)
  readonly children: readonly ComponentNode[];
};

// core/protocol/cdp/eval.ts — wrapper for `Runtime.evaluate`.
type EvaluateResponse<R> = { result: R; remoteException?: { name: string; message: string } };
async function evaluateOnTarget<R>(
  cdp: CdpSendLike,
  expression: string,
  options?: { returnByValue?: boolean; timeoutMs?: number },
): Promise<EvaluateResponse<R>>;

// The expression we ship to the app to grab the fiber root (a single round-trip).
const FIBER_ROOT_EXPRESSION = `
  (() => {
    const root = document.getElementById('root');
    const key = Object.keys(root).find(k => k.startsWith('__reactContainer'));
    return root[key]?.stateNode?.current?.child;
  })()
`;

// desktop (main) wiring
ipc channels:
  command:componentTree.snapshot   // walks the tree at click time, returns ComponentNode[]
  command:componentTree.refresh    // forces a fresh snapshot (same IPC, but explicit)
  event:componentTree.snapshot     // optional push (auto-refresh on every CDP frame? — defer)
```

**Why "click time" not "auto-refresh":** React trees change constantly; a live per-frame
tree would flood the renderer. The user clicks "Refresh" (or `Cmd-R` while focused on
the panel) when they want a fresh tree. The renderer's last snapshot stays visible
until the next click. This is the same posture as DevTools' "snapshot tree" mode.

**Why a single `Runtime.evaluate` and not a stream of events:** React's render lifecycle
is opaque to CDP — we can't subscribe to it cleanly. A snapshot is the right primitive
and the user controls when.

## React fiber quirks — defensive notes

- The exact key on the root element varies: `__reactContainer$xxxxx` (React 18+), or
  `_reactRootContainer` (older). The expression tries `__reactContainer$` first; on miss
  it falls back to scanning all `__react*` keys.
- `fiber.type` is the component class/function. `fiber.type.displayName ?? fiber.type.name`
  is the human-readable name; for `forwardRef` / `memo` it's `fiber.type.render.displayName`
  or `fiber.type.type.displayName`.
- The fiber tree is **not** a tree — it's a linked list (child/sibling). Walking is
  recursive on `child` first, then `sibling`.
- `fiber.memoizedProps` are the current props. `Object.entries` of them, stringified,
  is what the inspector shows. No deep traversal — JSON.stringify with a 2-level cut.
- The walker never throws on weird shapes; it returns what it can and tags the rest
  with a `name: '<unknown>'` placeholder. Defensive by construction.
- The walker is `pure` — it doesn't try to call `getDerivedStateFromProps` or anything
  that would mutate the tree. It's a read.

## Tasks

| # | Task | Size | Depends | Notes |
|---|------|------|---------|-------|
| T-17.1 | `core/protocol/cdp/eval.ts` — `evaluateOnTarget(cdp, expr, opts)` wrapping `Runtime.evaluate` with timeout + typed remote exception | S | E-14 (cdp.send live) | Mirrors the body-fetch pattern: a small typed wrappper, never throws |
| T-17.2 | `core/react-tree/walk.ts` — `walkReactTree(root, options)` pure walker; unit tests with hand-built fiber mocks | M | T-17.1 | The hard part is getting the property access right across React 16/17/18 |
| T-17.3 | `core/react-tree/expression.ts` — the `FIBER_ROOT_EXPRESSION` constant + helpers to detect "not an RN app" / "fiber root not found" / "remote exception" | S | T-17.2 | Tells the renderer what kind of error to show |
| T-17.4 | `desktop/main/component-tree-controller.ts` — owns the `evaluateOnTarget` call, builds the typed result, registers the IPC channels | M | T-17.1–3 | Mirrors `NetworkController` (T-16) — injectable, unit-testable |
| T-17.5 | Renderer: `ComponentTreeSection` — hierarchical panel with expand/collapse, name search (highlights matches), expand-to-show-props | L | T-17.4 | The visible-window is virtualized |
| T-17.6 | Tests: walker (hand-built fibers), evaluator wrapper (fake CDP), controller (IPC + typed errors), renderer search/filter (helper test, not full DOM) | M | T-17.1–5 | Same shape as the E-15/E-16 pyramids |

## Definition of Done — E-17

- Click "Refresh" → a hierarchical tree of the running app's React components appears.
- Each row shows: indent (depth), display name, optional badge for "Host" (the root).
- Click to expand → reveals children; second click to expand → reveals the resolved
  props (stringified, max depth 2, max 20 keys per node to keep the panel readable).
- Name search filters the tree: only nodes whose name contains the query stay visible;
  their ancestors are kept too (so the tree stays navigable).
- If the app is not an RN app, or the fiber root can't be found, the panel shows a
  clear typed message ("Component tree requires a connected React Native dev build")
  rather than crashing.
- Remote exceptions from `Runtime.evaluate` are surfaced as a typed error, not a thrown
  rejection.
- `core` coverage gate still holds; new code exercised by the canary (walk on a hand-
  built fiber) + the IPC controller tests + the evaluator wrapper tests.

## Explicitly out of scope (deferred)

- **Live auto-refresh.** The user clicks Refresh. Auto-refresh would require a
  MutationObserver in the app (push to CDP), or a CDP-side `Runtime.consoleAPICalled`
  trigger heuristic. Trigger: design-partner asks for it.
- **State / hooks inspection.** Showing `fiber.memoizedState` is straightforward but
  the inspector is v1 components-only. Trigger: design-partner asks.
- **Props editing.** Out. (No autonomous device / app actions — NG-6.)
- **Highlighting the inspected element in the running app.** That's the
  in-app bridge (OQ-22). Out of scope here; the inspector is read-only.
- **Performance annotations** (which component rendered the most, where the
  re-renders happen). That's E-19.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| The fiber-root expression breaks on some React version (16, 17, 18, 19) | The walker is a pure function with hand-built fiber mocks; the expression itself has explicit fallback paths (`__reactContainer$` → scan `__react*`) |
| `Runtime.evaluate` returns a `RemoteObject`, not a plain JSON value | Use `returnByValue: true` (the standard CDP flag) to get the snapshot; size is bounded by `Runtime.evaluate`'s own limits (default 16 MB) |
| A huge tree (10k+ nodes) freezes the renderer | The renderer's virtualization (E-11 pattern) means only the visible window renders. The walker's `maxDepth` + `maxNodesPerBranch` options cap the data the renderer gets |
| A props object with circular refs / huge arrays | `safeStringify` (custom, 2-level deep) — never throws; the panel never freezes |
| `Runtime.evaluate` times out on a busy app | Typed timeout (5s) + a clear "tree fetch timed out" UI state |
| A user accidentally clicks Refresh mid-tick and gets a stale snapshot | The renderer's spinner covers the await; the panel keeps showing the last snapshot until the new one lands |

## Why this slice — and what comes after

The M3+ backlog, in build order: E-15 (export, done), E-16 (network, done), E-17
(component tree, this), E-18 (storage), E-19 (performance), E-20 (navigation),
E-21 (release). Each is a real, scoped feature with its own plan doc + canary.
The pattern is proven: pure `core` piece + thin IPC + renderer surface, zero
core changes. E-17 lands when it lands.
