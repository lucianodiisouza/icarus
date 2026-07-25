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

## Entries seeded from the plan (pre-code)

The entries above are debts the _plan itself_ knowingly incurs. Real code will add more.
Nothing here is a surprise — each maps to a documented decision (ADR) or non-goal, which
is exactly the point: we only take debt we can name and have a plan to repay.

## Process note

At each Epic retrospective we (1) add any new debt discovered while building, (2) re-check
each active entry's trigger, and (3) schedule pay-down for any trigger that has fired.
Debt without a pay-down trigger is not allowed to be logged — an entry must say what
would make us fix it.
