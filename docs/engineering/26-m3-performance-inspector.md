# 26 — M3 Slice 5: Performance Inspector (E-19, minimal viable)

- **Milestone:** [M3+ — Additive Integrations](../planning/07-milestones.md).
- **What it delivers (v1, minimal viable):** A **Performance** section that shows:
  1. **JS heap size + used heap** — via CDP `Runtime.getHeapUsage` (a one-line call).
  2. **JS thread time** — via CDP `Performance.getMetrics` (returns `Timestamp`, `JsHeapUsedSize`, etc.).
  3. **Re-render counts** — derived from the existing component tree (E-17) by
     walking fibers and reading `fiber.memoizedState` for render counters (a tiny
     in-app probe ships with the inspector).
  4. **Recent console-error count** — over a configurable window (default 5 min), from
     the existing unified log + assistant context.
- **Why this is the minimal viable version, not the full perf plan:** the full
  M3+ performance epic (FPS, native thread, flamecharts, performance observer
  timeline) requires an **in-app bridge** (OQ-22) and an **RN-specific frame
  metrics** library. That's a much larger slice. v1 ships what we can get from
  CDP primitives + the existing tree, all from the proven seam.

> Sizes: **S ≤ ½ day · M 1–2 days**. The hard part is the in-app re-render probe
> (it has to be a tiny `globalThis` IIFE that the inspector's expression
> invokes), but the rest is reusing the `evaluateOnTarget` seam from E-17/E-18.

---

## Goal

A "Performance" panel that, on click of Refresh, returns a typed `PerfSnapshot`:
- `jsHeap`: { used, total, limit } (CDP `Runtime.getHeapUsage`)
- `jsMetrics`: { scripts, gcEvents, etc. } (CDP `Performance.getMetrics`)
- `renderHotspots`: top 10 components by re-render count, derived from the in-app probe
- `recentErrors`: count of console errors in the last N minutes

A small history graph (last 5 snapshots) for the JS heap usage would be a nice-to-have; v1 is the four numbers above.

## Design contract

```
// core (pure, Electron-free)
type PerfSnapshot = {
  readonly jsHeap: { readonly used: number; readonly total: number; readonly limit?: number };
  readonly jsMetrics: { readonly scriptCount: number; readonly gcEvents?: number; readonly timestamp?: number };
  readonly renderHotspots: readonly { readonly name: string; readonly renders: number }[];
  readonly recentErrorCount: number;
};

// desktop IPC
ipc channels:
  command:perf.snapshot  → PerfSnapshot  (typed result, never throws)
```

The renderHotspots need a per-component render count. React doesn't expose this directly. Options:
1. **Wrap `useState` / `useReducer`**: too invasive (requires patching the app).
2. **Patch `fiber.memoizedState` in-place**: too brittle.
3. **Ship a tiny dev-only `globalThis.__IcarusRenderCounter__` IIFE** the app installs in dev: it walks the fiber tree on demand and counts renders by checking `fiber.alternate` differences.

For v1 we go with option 3 — a single IIFE that, when invoked via `Runtime.evaluate`,
walks the current tree and reports `{name, renders}[]` (counts how many times each
component's fiber has `memoizedProps !== alternate.memoizedProps` since mount). It's a
heuristic but it's cheap and doesn't require app-side changes.

## Tasks

| # | Task | Size | Depends | Notes |
|---|------|------|---------|-------|
| T-19.1 | `core/protocol/cdp/perf.ts` — `getJsHeap(cdp)` + `getJsMetrics(cdp)` typed wrappers | S | E-17 (`evaluateOnTarget` seam) | Wraps `Runtime.getHeapUsage` and `Performance.getMetrics` |
| T-19.2 | `core/react-tree/render-counts.ts` — `collectRenderHotspots(root, options): RenderHotspot[]` — walks the tree, counts renders per component (heuristic via `memoizedProps !== alternate.memoizedProps`) | M | E-17 walker | Pure function, tested with hand-built fibers |
| T-19.3 | `desktop/main/perf-controller.ts` — owns the CDP calls + the render-hotspot expression, registers the IPC channel | M | T-19.1, T-19.2 | Mirrors the other inspector controllers |
| T-19.4 | Renderer: `PerfSection` — small panel with 4 cards (heap, metrics, top-renders, recent errors) | M | T-19.3 | Reuses the existing renderer's section shape |
| T-19.5 | Tests: heap wrapper, metrics wrapper, render-counts heuristic, controller IPC, renderer card rendering | M | T-19.1–4 | The E-19 canary: a synthetic fiber with N alternates produces the right render count |

## Definition of Done — E-19

- Click "Refresh" → four cards update with live values: JS heap used/total, JS
  metric counts, top-10 re-render hot components, recent-error count.
- The four values are all sourced from the live CDP session (no cached / stale
  numbers).
- A failed CDP call surfaces as a typed error; the panel shows the reason.

## Explicitly out of scope (deferred)

- **FPS / native frame timing.** Requires iOS `instruments` or an in-app bridge.
  Trigger: design-partner asks for it.
- **Performance timeline (flamecharts).** Requires the in-app bridge.
- **Auto-refresh.** Click time only, same as the other inspectors.
- **Re-render attribution (which props changed).** Would need a per-fiber render
  observer in the app; v1 just counts.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `Runtime.getHeapUsage` is unsupported on some Hermes versions | The wrapper returns `{ supported: false }`; the UI shows "Heap stats unavailable" instead of crashing |
| The re-render count heuristic is wrong (counts things that aren't real renders) | The card is labeled "Estimated re-renders" so the user knows it's a heuristic; the test asserts the *direction* (more alternates = more counts) rather than exact numbers |
| `Performance.getMetrics` returns 0 metrics on some RN versions | The UI shows "No metrics" with the raw count (0) so the user can see what was returned |

## Why this slice — and what comes after

The M3+ backlog, in build order: E-15 (export, done), E-16 (network, done),
E-17 (component tree, done), E-18 (storage, done), E-19 (perf, this),
E-20 (navigation), E-21 (release). After E-19: E-20 is the last "in-app
inspector" — it needs the in-app bridge (OQ-22) to expose React Navigation
state. E-21 is the only slice that needs work outside the
core/desktop/renderer triumvirate (signing, notarization, packaging).
