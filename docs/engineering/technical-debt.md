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
| TD-04 | CI matrix is **macOS-first**, not full cross-platform | macOS is primary target (NG-7) | Windows/Linux regressions unnoticed | When those become committed targets | 🟥 accepted |
| TD-05 | **Delta representation** for store→UI not finalized | Needs a real streaming feature to choose well (OQ-13) | Rework of the subscription path later | First streaming feature (M2 logs) | 🟥 planned |

## Entries seeded from the plan (pre-code)

The entries above are debts the _plan itself_ knowingly incurs. Real code will add more.
Nothing here is a surprise — each maps to a documented decision (ADR) or non-goal, which
is exactly the point: we only take debt we can name and have a plan to repay.

## Process note

At each Epic retrospective we (1) add any new debt discovered while building, (2) re-check
each active entry's trigger, and (3) schedule pay-down for any trigger that has fired.
Debt without a pay-down trigger is not allowed to be logged — an entry must say what
would make us fix it.
