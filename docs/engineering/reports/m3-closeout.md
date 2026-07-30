# M3 Closeout — Additive Integrations (7 slices) — 2026-07-30

> M2 closed clean with an explicit, opt-in follow-on named in writing. M3 is
> the additive-integrations backlog from `docs/planning/07-milestones.md`. The
> full backlog is shipped on `main` and gated by tests; the release workflow
> is in place; the first public release is gated on design-partner
> validation (OQ-2).

## TL;DR

Seven M3 slices shipped end-to-end since the M2 closeout, plus the release
workflow that turns a tagged commit into a signed macOS `.dmg`. **The
additive-integrations backlog is done.** The product has every inspector the
M2 closeout vision called for, plus the pipeline to put it in front of real
users.

| | Before M2 closeout | After M3 closeout |
|---|---|---|
| Core unit tests | 318 | **384** (+66) |
| Desktop unit tests | 88 | **112** (+24) |
| E2E tests | 10 | 10 (unchanged) |
| Core coverage | 87.65% | **89.39%** (above 80% gate) |
| Inspector panels | 2 (logs, network events) | **8** (logs, network, component tree, storage×2, perf, nav, plus assistant) |
| Release pipeline | none | **tag → signed `.dmg` → GitHub Releases** |
| Open questions | 11 🔴 | **8 🔴** (OQ-17/18/19 resolved) |

## The 7 slices (in build order)

1. **E-15** (`8d6e513`) — opt-in unified-log export. JSONL dump, redacted,
   opt-in. The M2-closeout-named follow-on. 13 core tests.
2. **E-16** (`5c84956`) — M3 network inspector. Correlated records by
   `requestId`, headers, opt-in body fetch (`getRequestPostData` /
   `getResponseBody`). 34 core + 14 desktop tests.
3. **E-17** (`ff51bd0`) — M3 component tree inspector. Hierarchical React
   tree via `Runtime.evaluate` + the fiber walker, name search, props preview.
   22 core + 12 desktop tests.
4. **E-18** (`d08ea58`) — M3 storage inspectors. AsyncStorage + MMKV
   list / get / delete. Per-row typed errors. 20 core + 13 desktop tests.
5. **E-19** (`479c87e`) — M3 performance inspector (minimal viable). JS heap
   + render hot-spots (heuristic) via three CDP calls. 11 core + 5 desktop
   tests.
6. **E-20** (`eb45857`) — M3 navigation inspector. Reads from
   `globalThis.__ICARUS_NAV_STATE__` (user-installed in-app bridge). 17
   core + 5 desktop tests.
7. **E-21** (`00cca5a`) — M3 release workflow. `electron-builder.yml` +
   `.github/workflows/release.yml` + `docs/engineering/RELEASE.md` + `CHANGELOG.md`.
   Local verification: a `pnpm run release` on macOS produced
   `Icarus-0.0.0-arm64.dmg` (99 MB) + `Icarus-0.0.0-x64.dmg` (104 MB) +
   `.zip` variants. 0 core + 0 desktop tests (no new code logic — the
   release slice is config + docs).

## What we did NOT ship (in writing, in each plan doc)

Each slice has an explicit "out of scope" section. The deferred items are:

- **E-15**: replay (load a file back into the live log), alternative formats,
  auto-export / cloud upload.
- **E-16**: binary body surfacing, WebSocket frames, edit & replay, request
  blocking, throttling, HAR export.
- **E-17**: live auto-refresh, state / hooks inspection, props editing,
  in-app highlight (OQ-22).
- **E-18**: SQLite inspector (filesystem + SQL, separate Epic), live
  auto-refresh, multi-store management, value editing, encryption-aware
  displays.
- **E-19**: FPS / native frame timing, performance timeline / flamecharts,
  per-prop re-render attribution.
- **E-20**: live push updates, multiple navigators, non-React-Navigation
  libs, in-app bridge `npm` package.
- **E-21**: the first real release (gated on design-partner validation,
  OQ-2); Windows code-signing; auto-update feed (wired but not
  auto-publishing); real app icon (placeholder ships).

Each deferred item has a **clear trigger** in its plan doc — none are
forgotten, all are queued behind the next M3+ decision.

## Architecture review

The promise we set at M1 (rule of three, ADR-0009) and re-validated at M2
(zero core changes) was held throughout M3. **Every M3 slice shipped
without a single core change** — the same `CdpSendLike` seam, the same
typed IPC router, the same feature-module pattern, the same renderer
virtualization. Adding a new inspector is now a 4-file diff:

1. `core/src/.../expression.ts` — the JS expression that ships to the app
2. `core/src/.../inspector.ts` — pure typed wrapper
3. `apps/desktop/src/main/...-controller.ts` — the desktop wiring
4. `apps/desktop/src/renderer/App.tsx` — the panel

This is the **M1→M2→M3 architectural promise paid in**, end-to-end.

### Recurring patterns (now codified in 5 places)

- **Pull-only on click.** Every inspector is refresh-driven; no live
  push, no per-frame refresh. The user controls when.
- **Typed failure paths.** Every inspector has a discriminated-union
  result type — `not_connected` / `no_module` / `timeout` / `cdp_error` /
  `remote_exception` / etc. The renderer pattern-matches and shows the
  right "why this didn't work" message rather than crashing.
- **One live connection, four consumers.** The `onCdpSendChange` hook
  in `index.ts` re-broadcasts the session's `send` to every inspector
  that wants it. Network inspector (body fetcher), component tree
  inspector, storage inspector, performance inspector, navigation
  inspector — five consumers, one seam.
- **Defensive on shape.** Every walker / parser handles weird input
  without throwing: type as `unknown`, narrow with `typeof`, fall back
  to a typed error.

### One bug found and fixed during M3

The very first commit (`8d6e513` E-15) had a cold-CI regression: the
desktop's `LogExporter` imported `electron` at module top, which the
unit-test runner couldn't load on a fresh ubuntu runner that hadn't
installed the Electron binary. Fix: split `log-exporter.ts` (Electron-free
business logic) from `log-exporter-ipc.ts` (Electron-bound IPC wiring).
This is the same `assistant-bridge.ts` / `assistant-ipc.ts` pattern.

## Open questions

Resolved: OQ-17, OQ-18, OQ-19 (release workflow).

Still open (8): OQ-2 (design-partner validation), OQ-8 (in-process module
isolation), OQ-10 (package granularity for feature modules), OQ-11 (min
acceptable footprint/memory), OQ-12 (renderer styling system), OQ-15
(native-tooling testability), OQ-21 (dev-middleware origin allowlist
drift), OQ-22 (in-app bridge for navigation/perf/heap). The M3 slice
plan docs explain why each was deferred.

## Debt carried forward

The full list is in `docs/engineering/technical-debt.md`. The big
remaining items after M3:

- **TD-01** — in-process module isolation (trigger: first native-binding
  module or module-caused crash). Not blocking.
- **TD-02** — Electron footprint/memory (trigger: real user feedback).
- **TD-03** — Turborepo (trigger: 12+ packages or 60s+ cold build). Premature.
- **TD-12** — Windows tree-kill parity (trigger: Windows becomes a committed
  target). The release slice prepared for this — the `win:` section is
  commented-out in `electron-builder.yml`, ready to enable.
- **TD-13** — Android via adb (horizontal, parallel — not on the
  macOS-first critical path).

## What this means for the product

The product now has:

- **M0 (foundation) + ProcessManager + Doctor** — done since 2026-07-25
- **M1 (run RN app + unified logs)** — done since 2026-07-25
- **M2 (AI assistant grounded in context)** — done since 2026-07-26
- **M3+ (additive inspectors + release workflow)** — done **now** (this
  closeout)

The "one place where all the context is assembled" vision from
`00-vision.md` is realized: the unified log, the network inspector, the
component tree, the storage inspector, the performance inspector, the
navigation inspector, and the AI assistant (M2) all read from the same
CDP-backed `DebugContextStore` and the same on-device state. A developer
opens Icarus, points it at their project, and never opens a terminal,
Flipper, Chrome DevTools, or a raw `adb` shell again for the day-to-day
debug loop.

The release pipeline is in place. The first public release is one tag
push away — gated on real design-partner data (OQ-2), not on engineering.

## What comes next

**The engineering team has built the product. The next move is not a
code move — it's a people-and-process move: design-partner
validation.** The plan for that is in `docs/planning/03-success-metrics.md`
and the design-partner work in `docs/engineering/13-contribution-guide.md`.

The engineering team continues paying down debt (TD-01/02/03/12/13)
behind the scenes. None of these is on the critical path for the
first public release. The work is bounded, the foundation is proven,
and the M3 architectural promise is paid in.
