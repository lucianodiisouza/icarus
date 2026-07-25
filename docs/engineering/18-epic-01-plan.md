# 18 — Epic 1 Implementation Plan: Walking Skeleton

- **Epic:** E-01 (revised to roadmap v2) — **Walking Skeleton**
- **Milestone:** M0, Track B
- **Depends on:** the CDP spike (Track A) being **in flight or done** — Track A gates
  investment, but the skeleton's early setup tasks (repo, toolchain) can proceed in
  parallel since they're not wasted regardless of the spike's outcome.
- **Prereq:** this M0 plan is signed off. _(Process rule: plan before code.)_

## Goal

The **thinnest possible vertical slice that is nonetheless real**: a hardened Electron
app whose renderer drives **one genuine command** through a typed, validated IPC
boundary into an **Electron-free `core`**, which does one true thing and returns a
result — all under green CI, runnable by a new contributor in < 15 minutes.

This is deliberately _not_ a framework. Per [ADR-0009](../adr/ADR-0009-defer-abstractions-rule-of-three.md),
we build no IPC streaming, no store deltas, no module SDK here.

### What makes it "real" (not a hello-world)

The one command is **`doctor.check`** — the renderer asks `core` to detect the local RN
toolchain (node/watchman/adb/xcrun) and render the result. This is chosen deliberately:
it exercises the full boundary (renderer → preload → validated IPC → core → real
OS-touching work → typed result → UI), it's genuinely useful (US-08, TR-4), and it has
**zero dependency on the CDP spike's outcome** — so it's never wasted work.

## Scope

### In scope
1. Monorepo + toolchain (pnpm workspace, TS strict, lint/format, CI).
2. Hardened Electron shell (ADR-0004 in full, from the first commit).
3. Typed IPC: **query + command only**, validated at the boundary.
4. Electron-free `core` skeleton with the boundary lint rule.
5. One real capability wired end-to-end: **`doctor`** (the environment check).
6. Test harness + the security/boundary assertions that must never regress.

### Explicitly out of scope (deferred — ADR-0009)
IPC subscription/batching · `DebugContextStore` deltas · `FeatureModule` SDK ·
conformance kit · throwaway example module · `ProcessManager` (its own Epic E-06, lands
alongside in M0 but is planned separately) · any UI beyond a single functional screen ·
styling system (OQ-12).

## Package layout for Epic 1 (3 packages, per review A-3)

```
apps/desktop/        Electron main + preload + React renderer
packages/core/       Electron-free logic (doctor lives here); the enforced boundary
packages/config/     shared tsconfig-base + eslint-config + prettier  (dev-only)
```
`ipc` and `module-sdk` are **not** separate packages yet — the IPC contract types live in
a small `apps/desktop/src/shared/` (imported by main, preload, renderer) until a second
consumer justifies extraction. This is the A-3 simplification in practice.

## Task breakdown (sequenced; sizes S≤½d / M 1–2d / L 3–5d)

| # | Task | Size | Depends | Notes |
|---|------|------|---------|-------|
| 1 | Repo init: git, `.gitignore`, `.editorconfig`, `.nvmrc`, LICENSE, root README→docs | S | — | |
| 2 | pnpm workspace + 3-package skeleton; `engines`/pnpm pinned | S | 1 | |
| 3 | `packages/config`: `tsconfig-base` (strict + `noUncheckedIndexedAccess`), eslint, prettier | M | 2 | |
| 4 | **Boundary lint rule**: forbid `electron` (+ renderer-only) imports in `core` | M | 3 | The one abstraction that pays off day one |
| 5 | Root scripts: `typecheck/lint/format:check/test/build`; lint-staged + commit-msg hook | S | 3 | |
| 6 | `apps/desktop` Electron main: window + app lifecycle | M | 5 | |
| 7 | React + Vite renderer (electron-vite); HMR in dev | M | 6 | Minimal single screen |
| 8 | **Preload bridge**: narrow typed API, no raw `ipcRenderer` | M | 7 | ADR-0004 |
| 9 | Security baseline: contextIsolation, no nodeIntegration, sandbox, CSP | M | 8 | ADR-0004 |
| 10 | Shared IPC contract types + Zod boundary validation helper | M | 8 | in `src/shared/` |
| 11 | **Query** primitive (request/response) + unit test | M | 10 | |
| 12 | **Command** primitive + allowlist router; reject unregistered/invalid | M | 10 | |
| 13 | `packages/core`: `doctor` — detect node/watchman/adb/xcrun; typed result (Electron-free) | M | 4 | US-08, TR-4 |
| 14 | Wire `doctor.check` end-to-end: renderer button → command → core → result screen | M | 11,12,13 | The "it's real" moment |
| 15 | Vitest harness + **coverage gate on `core`** (≥80%) | M | 5 | |
| 16 | Security/boundary assertion tests (hardening flags set; unregistered channel rejected; no-electron-in-core) | M | 9,12 | Must never regress |
| 17 | E2E smoke (Playwright-for-Electron): app launches + `doctor.check` round-trip | M | 14 | |
| 18 | CI pipeline (install→typecheck→lint→test→build→package) < 10 min; macOS runner + Linux for `core` | L | 15,16 | Doc 15 |
| 19 | Onboarding doc; measure < 15-min clean-machine setup | S | 18 | Metric |

**Suggested execution order:** 1→2→3→4→5 (toolchain & boundary) · 6→7→8→9 (hardened
shell) · 10→11→12 (IPC) · 13 (core doctor, can start after 4, in parallel) · 14 (wire)
· 15→16→17 (tests) · 18→19 (CI & onboarding). Tasks 6–9 and 13 can overlap once the
toolchain (1–5) is up.

## Definition of Done (Epic 1)

- App launches; **`doctor.check` completes end-to-end** through the validated boundary
  and renders a real toolchain report.
- `core` builds & tests **without Electron**; boundary lint fails on violation (proven
  by a test).
- Security baseline asserted in CI (contextIsolation, no nodeIntegration, CSP, allowlist);
  unregistered/invalid IPC rejected (tested).
- Query + command primitives typed end-to-end and unit-tested; **no `any` across the
  boundary.**
- CI green under ~10 min; `core` coverage ≥ 80% with meaningful assertions.
- New contributor runs from source in < 15 min (measured, recorded).
- **Epic retrospective ritual** run: docs updated to match reality, architecture
  re-reviewed, [tech debt](technical-debt.md) logged, improvements proposed.

## Risks specific to Epic 1

| Risk | Mitigation |
|------|------------|
| electron-vite / preload + strict CSP + sandbox interplay is fiddly | Tasks 6–9 are sequenced and small; get the hardened shell green before adding IPC. Time-box spikes on config. |
| `doctor` OS-detection is more varied than expected (paths, versions) | Keep it best-effort and _honest_ — report "not found / unknown" rather than guessing (Coding Standards: no silent failure). macOS-first (NG-7). |
| Over-building "just a bit" of framework | ADR-0009 is the guardrail; PR review rejects speculative abstraction. If tempted to add streaming/SDK, stop — that's M1. |
| CI wall-clock creeps toward 10 min early | Parallelize verify stage; pnpm store cache. Turborepo remains the deferred escape hatch (ADR-0001). |

## Why this is the right Epic 1

It delivers the **smallest thing that proves the architecture's load-bearing claims** —
the Electron-free core boundary, the hardened validated IPC trust boundary, and a real
capability crossing them — while building **zero** speculative framework. Every task
produces something that survives regardless of the CDP spike's outcome, so it's safe to
start the non-spike setup tasks in parallel with Track A. It also ships something a
developer would actually value on day one (a working environment doctor), turning the
"walking skeleton" into a walking, _useful_ skeleton.
