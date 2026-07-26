# 10 — Tasks (Milestone M0)

Per our elaboration policy ([Epics](08-epics.md)), a milestone is decomposed to task level
**when it is committed** — decomposing ahead of that would be fake certainty. This doc holds
the **M0** decomposition. Later decompositions live in their own committed plan docs:
M0 primitives in [20](../engineering/20-m0-primitives-plan.md), and **M2 (AI assistant) in
[21 — M2 Plan](../engineering/21-m2-ai-assistant-plan.md)** (committed once OQ-6/OQ-7/OQ-9
resolved and E-10 landed).

Estimates are **relative sizes (S ≈ ≤½ day, M ≈ 1–2 days, L ≈ 3–5 days)**, not dates.
Each task notes its Epic and any dependency. Tasks are ordered to keep `main` releasable
and to front-load the boundary-enforcing pieces.

> **Note:** These are the _first_ code-producing tasks. They begin **only after this M0
> plan is signed off** (per the process rule: plan before code).

---

## E-01 — Repository & toolchain foundation

| ID | Task | Size | Depends |
|----|------|------|---------|
| T-01.1 | Initialize git repo, `.gitignore`, `.editorconfig`, LICENSE, root `README` pointing at `docs/` | S | — |
| T-01.2 | pnpm workspace: root `package.json`, `pnpm-workspace.yaml`, `packages/`+`apps/` layout per [Doc 11](../engineering/11-folder-structure.md) | S | T-01.1 |
| T-01.3 | Shared config packages: `tsconfig-base` (strict), `eslint-config`, `prettier` | M | T-01.2 |
| T-01.4 | Boundary lint rule: forbid `electron` (and renderer-only deps) imports in `core` | M | T-01.3 |
| T-01.5 | Root scripts: `typecheck`, `lint`, `format:check`, `test`, `build` wired workspace-wide | S | T-01.3 |
| T-01.6 | Commit hooks (lint-staged) + commit-message convention check | S | T-01.5 |

## E-02 — Hardened Electron shell

| ID | Task | Size | Depends |
|----|------|------|---------|
| T-02.1 | `apps/desktop`: Electron main entry, window creation, app lifecycle | M | T-01.5 |
| T-02.2 | Renderer app (React + Vite per [ADR-0005](../adr/ADR-0005-ui-stack.md)); HMR in dev | M | T-02.1 |
| T-02.3 | `preload` bridge exposing a **narrow typed API** (no raw ipcRenderer) | M | T-02.2 |
| T-02.4 | Apply security baseline (ADR-0004): contextIsolation, no nodeIntegration, sandbox, CSP | M | T-02.3 |
| T-02.5 | Automated security assertions (test that the hardening flags are set) | S | T-02.4 |
| T-02.6 | Shell threat-model note in `docs/engineering/` | S | T-02.4 |

## E-03 — Typed IPC layer

| ID | Task | Size | Depends |
|----|------|------|---------|
| T-03.1 | IPC contract types + schema/validation helper (Zod) at the boundary | M | T-02.3 |
| T-03.2 | **Query** primitive (request/response) + example + unit test | M | T-03.1 |
| T-03.3 | **Command** primitive (validated intent) + allowlist router; reject unregistered | M | T-03.1 |
| T-03.4 | **Subscription** primitive (snapshot+deltas) with batching/backpressure + test | L | T-03.1 |
| T-03.5 | Renderer-side typed client + Zustand mirror wiring | M | T-03.2..4 |

## E-04 — Core skeleton (shell-agnostic)

| ID | Task | Size | Depends |
|----|------|------|---------|
| T-04.1 | `packages/core` package; assert zero Electron imports (T-01.4 rule applies) | S | T-01.4 |
| T-04.2 | `EventBus` (typed pub/sub, backpressure-aware) + tests | M | T-04.1 |
| T-04.3 | `Logger` (structured) + `Config` (typed, with schema) + tests | M | T-04.1 |
| T-04.4 | `DebugContextStore`: typed slices, snapshot, subscribe/delta emit + tests | L | T-04.2 |

## E-05 — Feature-module contract + example module

| ID | Task | Size | Depends |
|----|------|------|---------|
| T-05.1 | Define `FeatureModule` + `ModuleContext` (scoped capabilities) types (ADR-0007) | M | T-04.4, T-03.3 |
| T-05.2 | Module registry in Main (register/init/dispose lifecycle) | M | T-05.1 |
| T-05.3 | **Contract-conformance test kit** modules must pass | M | T-05.1 |
| T-05.4 | Throwaway **example module**: 1 command + 1 store slice + 1 UI view, no core edits | M | T-05.2, T-03.5 |
| T-05.5 | Measure & document "add a module" time against the example (Metric G-1) | S | T-05.4 |

## Cross-cutting (spans E-01..E-05)

| ID | Task | Size | Depends |
|----|------|------|---------|
| T-X.1 | CI pipeline (see [CI/CD](../engineering/15-ci-cd.md)): install→typecheck→lint→test→build→package; < 10 min | L | T-01.5 |
| T-X.2 | Unit-test harness (Vitest) + coverage gate on `core` | M | T-01.5 |
| T-X.3 | E2E smoke (Playwright-for-Electron): app launches, IPC round-trip | M | T-02.4, T-03.5 |
| T-X.4 | Onboarding doc + measure < 15-min setup on a clean machine (Metric) | S | E-02 done |

---

## M0 Definition of Done (rolls up the Epic DoDs)

- All M0 Epic DoDs met (see [Epics](08-epics.md)).
- Every [M0 user story](09-user-stories.md) (US-01..US-05) has passing acceptance
  checks.
- Foundation-health [Success Metrics](03-success-metrics.md) measured and recorded.
- **Epic retrospective ritual** run for the milestone: docs updated, architecture
  reviewed, [tech debt](../engineering/technical-debt.md) logged, improvements proposed.

## What is intentionally NOT here

M1/M2/M3 tasks. They will be decomposed when their milestone is committed. The CDP spike
(E-Spike-CDP) is the next thing to plan in detail **after M0**, because its outcome
reshapes M2.
