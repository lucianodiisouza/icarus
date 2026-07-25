# Technical Debt Log

A living, honest record of debt we knowingly take on. Debt is not shameful — _hidden_
debt is. Every entry: what, why we accepted it, the cost/risk it carries, and the
trigger or plan to pay it down. Updated as part of the **mandatory Epic retrospective**
([README](../README.md)).

Status: 🟥 active · 🟨 mitigated · 🟩 paid down.

| ID | Debt | Why accepted | Risk it carries | Pay-down trigger | Status |
|----|------|--------------|-----------------|------------------|--------|
| TD-01 | Feature modules run **in-process** (no fault isolation) | Velocity for the foundation; zero modules exist yet | A bad module can crash Main | First native-binding module or first module-caused crash (OQ-8) | 🟥 planned |
| TD-02 | **Electron footprint/memory** unoptimized | Stay in Node ecosystem; footprint is a non-goal now (NG-8) | Could become an adoption blocker | Real user feedback sets a threshold (OQ-11) | 🟥 planned |
| TD-03 | No **Turborepo** build cache | Premature at ~5 packages (ADR-0001) | Slower CI as packages grow | Cold build > 60s or > 12 packages | 🟥 monitored |
| TD-04 | CI runs on **ubuntu-latest only** (not macOS/matrix) | No iOS/native tooling yet; ubuntu is fast/cheap (Doc 15) | macOS/Windows-specific regressions unnoticed | When device tooling (simctl/adb) lands, or Win/Linux become committed targets | 🟥 accepted |
| TD-05 | **Delta representation** for store→UI not finalized | Needs a real streaming feature to choose well (OQ-13) | Rework of the subscription path later | First streaming feature (M1 logs) | 🟥 planned |

## Epic 1 (Walking Skeleton) retrospective — 2026-07-25

Epic 1 shipped (core + doctor + typed IPC + hardened Electron shell + CI; 26 tests;
CI green). Deferred work, logged so it isn't lost:

| ID | Deferred item | Why deferred | Pay-down trigger | Status |
|----|---------------|--------------|------------------|--------|
| TD-06 | **Automated security-flag assertions** (contextIsolation/sandbox/CSP/allowlist) not yet tested in CI | Asserting live `webPreferences` needs a launched Electron instance (no display here) | Next desktop Epic that adds an E2E harness | 🟥 planned |
| TD-07 | **No Playwright-for-Electron E2E smoke** (app-launch + doctor.check round-trip) | Needs a display + the Electron binary; headless env/CI bundles but doesn't launch | Add a display-enabled CI job or local run in the next desktop Epic | 🟥 planned |
| TD-08 | ~~GUI launch of the walking skeleton is unverified~~ | — | — | 🟩 **resolved 2026-07-25**: `electron-vite dev` launches the window with no errors on macOS; renderer serves on :5173. Needed the electron binary in `onlyBuiltDependencies`. |
| TD-09 | **`no-floating-promises` lint is off** (needs type-aware linting config) | Deferred to keep the first ESLint setup simple | Enable typed linting per-package in a follow-up | 🟥 planned |
| TD-10 | **`core` coverage gate (≥80%) not enforced** in CI yet | Tests exist and pass; the gate flag is not wired | Wire `vitest --coverage` threshold in the next CI touch | 🟥 planned |

Architecture held up well: the Electron-free `core` was fully unit-testable without a
shell (the ADR-0002 hedge paying off immediately), and the boundary lint rule caught a
deliberate violation. No architecture changes proposed.

## E-06 (ProcessManager) — deferred items — 2026-07-25

ProcessManager shipped with a 0-orphans soak test (25 procs + grandchildren) proving the
detached-group teardown. Known gaps, deferred with triggers:

| ID | Deferred item | Why deferred | Pay-down trigger | Status |
|----|---------------|--------------|------------------|--------|
| TD-11 | **Cross-launch reaper** for hard-crash orphans | Clean-exit teardown covers `disposeAll`; a `SIGKILL` of Icarus itself can't run cleanup, and detached children then survive | First real long-lived spawn (M1 Metro), or first reported orphan | 🟥 planned (doc 20 T-06.9) |
| TD-12 | **Windows tree-kill parity** (currently best-effort `taskkill`) | macOS-first (NG-7); POSIX group-kill is the tested path | Windows becomes a committed target | 🟥 accepted (doc 20 T-06.10) |

## Epic 1 (Walking Skeleton) retrospective — 2026-07-25

Epic 1 shipped (core + doctor + typed IPC + hardened Electron shell + CI; 26 tests;
CI green). Deferred work, logged so it isn't lost:

| ID | Deferred item | Why deferred | Pay-down trigger | Status |
|----|---------------|--------------|------------------|--------|
| TD-06 | **Automated security-flag assertions** (contextIsolation/sandbox/CSP/allowlist) not yet tested in CI | Asserting live `webPreferences` needs a launched Electron instance (no display here) | Next desktop Epic that adds an E2E harness | 🟥 planned |
| TD-07 | **No Playwright-for-Electron E2E smoke** (app-launch + doctor.check round-trip) | Needs a display + the Electron binary; headless env/CI bundles but doesn't launch | Add a display-enabled CI job or local run in the next desktop Epic | 🟥 planned |
| TD-08 | ~~GUI launch of the walking skeleton is unverified~~ | — | — | 🟩 **resolved 2026-07-25**: `electron-vite dev` launches the window with no errors on macOS; renderer serves on :5173. Needed the electron binary in `onlyBuiltDependencies`. |
| TD-09 | **`no-floating-promises` lint is off** (needs type-aware linting config) | Deferred to keep the first ESLint setup simple | Enable typed linting per-package in a follow-up | 🟥 planned |
| TD-10 | **`core` coverage gate (≥80%) not enforced** in CI yet | Tests exist and pass; the gate flag is not wired | Wire `vitest --coverage` threshold in the next CI touch | 🟥 planned |

Architecture held up well: the Electron-free `core` was fully unit-testable without a
shell (the ADR-0002 hedge paying off immediately), and the boundary lint rule caught a
deliberate violation. No architecture changes proposed.

## E-06 (ProcessManager) — deferred items — 2026-07-25

ProcessManager shipped with a 0-orphans soak test (25 procs + grandchildren) proving the
detached-group teardown. Known gaps, deferred with triggers:

| ID | Deferred item | Why deferred | Pay-down trigger | Status |
|----|---------------|--------------|------------------|--------|
| TD-11 | **Cross-launch reaper** for hard-crash orphans | Clean-exit teardown covers `disposeAll`; a `SIGKILL` of Icarus itself can't run cleanup, and detached children then survive | First real long-lived spawn (M1 Metro), or first reported orphan | 🟥 planned (doc 20 T-06.9) |
| TD-12 | **Windows tree-kill parity** (currently best-effort `taskkill`) | macOS-first (NG-7); POSIX group-kill is the tested path | Windows becomes a committed target | 🟥 accepted (doc 20 T-06.10) |

## M1 retrospective — 2026-07-25

M1 (the "first useful loop": run an RN app + unified logs) shipped via the following
slices, all on `main`:

| Slice | Epic | What it does |
|---|---|---|
| E-14 slices 1-3 | CDP transport | Discovery, target selection, Origin-authed client, multiplexing proxy, live console wiring |
| E-14 slice 4 | Auto-reconnect | Exponential backoff across reload/Metro-restart (C3) |
| E-14 slice 5 | Network domain | Live request/response/failed capture, graceful degrade on RN < 0.76 |
| E-08 | Metro control | Detect project, start/stop Metro, capture listening port, log stream |
| E-09 | Devices (iOS) | List/boot/install/launch via `xcrun simctl` |
| E-10 | Unified log pipeline | Fan-in CDP + Metro + iOS simctl log stream; one panel with source/level tags |
| E-11 | Log UI | Search, filter chips, hand-rolled virtualizer (≈ 24 rows in window) |
| E-05 | Module contract | `FeatureModule` / `ModuleContext` interface + conformance test kit, extracted from the three real modules |

Test count: **88 → 151** (+63). CI green on every slice. 7 PRs merged.

Architecture held: the ProcessManager + EventBus + DebugContextStore foundation carried
every module without change. No architecture changes proposed. The M1 DoD
('design partner reaches "app running + live logs" unaided on ≥ 4/5 tested setups') is
**reachable** but unverified — needs design-partner feedback to mark done.

Deferred work, logged so it isn't lost:

| ID | Deferred item | Why deferred | Pay-down trigger | Status |
|----|---------------|--------------|------------------|--------|
| TD-13 | **Android via adb** (E-09 + E-10 follow-up) | macOS-first (NG-7); iOS shipped first, Android slots into the same `SimctlExecutor`-shape seam | Android becomes a committed target | 🟥 accepted |
| TD-14 | **Wrap Metro/Devices/Logs as `FeatureModule`s** (E-05 follow-up) | Mechanical one-line wrap per controller; deferred to keep E-05 a small interface-extraction slice | Next module lands (or first refactor pass) | 🟩 **resolved 2026-07-25**: thin adapters in `feature-module/{metro,unified-log,devices}-module.ts`. Conformance kit run against all 3 (PR #20). |
| TD-15 | **`ModuleRegistry`** that auto-wires IPC channels for registered modules | The 'adding a new module needs no core changes' DoD (ADR-0007) | E-05 refactor + first new module lands | 🟨 **partial 2026-07-25**: lifecycle registry landed in `feature-module/module-registry.ts` and wired in main (PR #20). The "auto-wires IPC channels" half is still open — the existing imperative event wiring in `createWindow` is the right shape for v1 but a future slice can make it declarative. |
| TD-16 | **Auto-attach: Metro ready + sim booted → CDP connect** | Plumbing is in place (controllers all know about each other through main); the *policy* needs design-partner input | M1 design-partner feedback | 🟥 planned |
| TD-17 | **`UnifiedLogController.dispose()` on app exit** | The controller is constructed at module load; the `will-quit` hook should call `dispose()` to clear the fan-in subscriptions. Tracked separately to keep E-10 small. | App-exit hardening pass | 🟩 **resolved 2026-07-25**: covered by the ModuleRegistry in PR #20. The unified-log module's `dispose()` calls `controller.dispose()`, and the registry's `disposeAll()` is wired to `app.on('will-quit')` ahead of `ProcessManager.disposeAll()`. |
| TD-18 | **`ios-syslog` auto-start on `devices.boot`** | The source is ready; the policy is fuzzy (which udid if multiple sims booted) | M1 design-partner feedback | 🟥 planned |
| TD-19 | **Persist the unified log to disk** (OQ-9) | Cross-cutting concern (logs, store, future replay); deferred to a unified persistence epic | Persistence epic (M2+) | 🟥 planned |
| TD-20 | **E-14 charter items not yet shipped**: Android via adb (see TD-13); large-payload framing (upstream RN #56471, not our problem); OQ-21 Origin allowlist drift (RN-side config) | See E-14 charter | See E-14 charter | 🟥 planned |

M1 → M2 gate: M2 (AI data boundary + assistant) is blocked on **OQ-6** (telemetry consent
policy) and **OQ-7** (AI provider choice: local / API / BYOK). Both must resolve before
E-12 / E-13 can start designing.

The entries above are debts the _plan itself_ knowingly incurs. Real code will add more.
Nothing here is a surprise — each maps to a documented decision (ADR) or non-goal, which
is exactly the point: we only take debt we can name and have a plan to repay.

## Process note

At each Epic retrospective we (1) add any new debt discovered while building, (2) re-check
each active entry's trigger, and (3) schedule pay-down for any trigger that has fired.
Debt without a pay-down trigger is not allowed to be logged — an entry must say what
would make us fix it.
