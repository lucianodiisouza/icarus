# 07 — Milestones (v2 · ACCEPTED)

> **Decisions locked 2026-07-25:** v2 roadmap **accepted** (spike-first, walking-skeleton
> M0). Targets: **both bare RN + Expo**; **macOS-first**; **GitHub Actions** CI. See
> [Open Questions](99-open-questions.md) OQ-1/OQ-3/OQ-16/OQ-20.

> **v2 — revised 2026-07-25** after [Architecture Review #1](../engineering/17-architecture-review-2026-07-25.md).
> Two corrections drove the rewrite: **(F-1)** the CDP feasibility spike — the highest,
> most vision-defining risk — was gated _behind_ a large foundation; it now comes
> **first and standalone**. **(F-2)** the original M0 built speculative framework
> (module SDK, IPC streaming, store deltas) before any real consumer existed; that is
> deferred to the milestone where real features justify it (rule of three, ADR-0009).
> The v1 milestone map is preserved in the review doc's "was" column.

Milestones are **outcome-defined**, not date-defined. We deliberately avoid fake
calendar certainty in Phase 0; each lists exit criteria and rough size (S/M/L/XL). Every
milestone ends with the mandatory **Epic retrospective ritual** (update docs, review
architecture, log tech debt, propose improvements).

Sequencing now encodes a sharper priority: **test the scariest unknown before building
anything of size, then build the thinnest real thing.**

---

## M0 — CDP Spike (gate) + Walking Skeleton + Process Core  · size M–L
**Theme:** Prove the ground holds, then lay the thinnest real slab. No framework we
don't yet need.

**Two tracks, run together; Track A gates the rest:**

**Track A — CDP feasibility spike (standalone, ~week 1, the go/no-go gate).**
A disposable Node script (no Electron, no IPC, no modules): start Metro against **both a
bare-RN and an Expo dev-client** sample app, discover the inspector proxy, enumerate
targets, open the CDP WebSocket, and read one real datum (e.g. a console event /
`Runtime.evaluate`). Must also probe **HR-1 discovery/reconnect** and **HR-3 coexistence
with the user's own RN DevTools**.

**Track B — Walking skeleton + genuinely-needed primitives.**
Thinnest vertical slice: monorepo (~3 packages), TS strict, **hardened** Electron shell
(ADR-0004 in full), typed IPC with **query + command only** (no subscription/batching
yet), an Electron-free `core`, one **real** command round-trip, CI, and the low-level
primitives the first loop truly needs: **`ProcessManager`** (G-2, soak-tested) and the
environment **`doctor`** (TR-4).

**Exit criteria:**
- **Spike:** documented **go/no-go** on OQ-4 for bare RN _and_ Expo; ADR-0008 Accepted
  or superseded by a fallback ADR. **If no-go, stop and replan before Track B invests
  further.**
- App launches; one **real** typed query + command round-trip works, validated at the
  boundary.
- `core` compiles with **zero Electron imports** (lint-enforced).
- Security baseline (ADR-0004) verified in CI (context isolation, no nodeIntegration,
  CSP, IPC allowlist).
- `ProcessManager`: **0 orphaned processes across a 50-run force-quit soak test.**
- `doctor` detects/validates node, watchman, adb, xcrun (macOS-first).
- CI green (install→typecheck→lint→test→build→package) under ~10 min.
- New-contributor runs from source in < 15 min (measured).

**Explicitly deferred out of M0** (was in v1's M0): IPC subscription/batching, store
snapshot/delta machinery, the `FeatureModule` SDK, the conformance kit, the throwaway
example module. These are built in M1 from real need.

**Related:** revised Epics — E-Spike-CDP (Track A); **E-01 Walking Skeleton** (Track B,
see [Epic 1 plan](../engineering/18-epic-01-plan.md)); E-06 ProcessManager; E-07 doctor.
Goals G-1(boundary only), G-2, G-8, G-7. Risks TR-1 (gate), TR-2, TR-4.

---

## M1 — First Useful Loop: Run an RN App + Unified Logs  · size XL
**Theme:** The smallest thing a real developer would open Icarus for — and the point
where we **extract the module abstraction from real features**, not speculation.
**Delivers:** Detect an RN project → start Metro → launch on a simulator/emulator →
**unified live logs** (Metro + native + console), searchable/filterable. First real
`DebugContextStore` slices. **Here** we build: the IPC **subscription/streaming**
primitive (ADR-0006, TR-6), store deltas, and — once `metro`/`devices`/`logs` reveal the
real shared shape (rule of three) — the `FeatureModule` contract + conformance kit
(ADR-0007/0009).

**Exit criteria:**
- A design partner reaches "app running + live logs" unaided on ≥ 4/5 tested setups.
- Log pipe sustains a synthetic high-rate stream without UI jank (validates TR-6).
- The module abstraction is extracted such that **adding the _second_ real feature needs
  no core changes** — the honest G-1 test (replaces the v1 circular metric).
- Informal probe: a store snapshot handed to an LLM once, to sanity-check the store's
  shape before M2 (A-4).

**Related:** Epics E-08 metro, E-09 devices, E-10 logs pipe, E-11 log UI, plus the
extracted E-05 module SDK. Goals G-3(real), G-4, G-5. Risks TR-6.

---

## M2 — AI Assistant Grounded in Context (thin slice)  · size L
**Theme:** Deliver the headline differentiator, responsibly.
**Delivers:** An assistant that reads a `DebugContextStore` snapshot and answers
questions over it, with an explicit, visible **data-boundary / redaction** step (TR-5)
and a resolved AI data-handling decision (OQ-6/OQ-7). No autonomous device/repo actions
(NG-6).

**Exit criteria:**
- Assistant answers using data the user did **not** paste manually (G-6).
- "What gets sent" is visible and user-controllable; redaction pass in place.
- OQ-6 and OQ-7 resolved and documented (ADR).

**Related:** Epics E-12 data-boundary, E-13 grounded assistant. Goals G-6, G-7. Risks
TR-5.

---

## M3+ — Additive Integrations (backlog, unordered)  · size varies
Everything else from the vision — network inspection, component tree, storage
inspectors (AsyncStorage/MMKV/SQLite), performance, navigation, native logs, device
management, build system — becomes an **additive feature-module Epic** on the now-proven
foundation. Ordering will be **driven by design-partner evidence** (Success Metrics),
not guessed now. Each is a candidate Epic; we commit them one milestone at a time.

---

## Why this sequence (v2 rationale)

1. **Spike first, gate everything.** The CDP unknown (TR-1/OQ-4) is the most
   vision-defining risk; a ~100-line standalone script can answer it in week one. A
   "no-go" then costs days, not a milestone. (Review finding F-1.)
2. **Walking skeleton, not a framework.** M0 builds only what a real end-to-end slice
   needs plus the low-risk primitives (`ProcessManager`, `doctor`). Streaming, store
   deltas, and the module SDK are deferred to where real features justify them —
   avoiding speculative generality. (F-2, ADR-0009.)
3. **M1 is one coherent loop** and the place we _earn_ our abstractions from real
   duplication (rule of three), protecting focus (PR-4) and producing the first honest
   user signal.
4. **M2 (AI) after real context exists** avoids PR-2 (over-promising an AI with nothing
   to reason over); the store shape is informally probed in M1 first (A-4).
5. **M3+ stays unordered on purpose** — we refuse to fake certainty about feature
   priority before we have users. Evidence orders it.

> **Note on Epic IDs:** [Epics](08-epics.md) is reconciled to this v2 map (charter level
> for M1+, task level for M0) with a v1→v2 mapping table. Task-level detail exists for
> the M0 epics: [Walking Skeleton](../engineering/18-epic-01-plan.md),
> [ProcessManager & Doctor](../engineering/20-m0-primitives-plan.md),
> [CDP Spike](../engineering/19-cdp-spike-plan.md).
