# 17 — Architecture Review · 2026-07-25 (Review #1)

- **Reviewer role:** Senior Staff Engineer (independent cold read of all Phase-0 docs)
- **Verdict:** Direction is sound; **sequencing and scope are wrong in two important
  ways.** Recommend a roadmap correction _before_ any code. Details below.
- **Outcome:** [Milestones](../planning/07-milestones.md) rewritten (v2); this review
  records _why_. Two new ADRs proposed (see end).

This document does what a real staff review does: it argues with the plan. Where the
original plan holds up, I say so briefly; where it doesn't, I spend the words.

---

## 1. The two findings that change the plan

### F-1 (critical) — We gated the scariest risk behind the biggest build. Invert it.

The original roadmap runs **M0 (large foundation) → M1 (CDP spike, the go/no-go gate)**.
That is backwards. TR-1 / OQ-4 — "can a third-party tool actually drive CDP through
Metro's inspector proxy?" — is simultaneously **the highest-uncertainty and the most
vision-defining** unknown in the entire project. Everything downstream (component tree,
Hermes state, network, the AI's context) assumes it's a yes.

Yet the plan spends an entire **L-sized** foundation milestone _before_ testing it. If
the answer is "no," we will have built a hardened Electron shell, a typed 3-primitive
IPC layer, a module SDK, and a conformance kit **for a product whose data-acquisition
strategy just collapsed.** That is the classic "build the cathedral, then check if the
ground holds" mistake.

**The spike does not need the foundation.** Proving CDP-over-Metro is a ~100-line
standalone Node script: start Metro against a sample app, hit the inspector proxy's
target-list endpoint, open a WebSocket, send `Runtime.enable` / read one console event.
No Electron, no IPC, no modules. It can run in **week one**.

**Correction:** move the CDP spike to **first**, as a standalone track gating
everything else. Build the foundation _after_ (or in parallel with, but never behind)
the answer. This is the single highest-value change in this review.

### F-2 (major) — The M0 foundation is speculative generality. Cut ~40% of it.

The original M0 builds, before a single real feature exists:
- a typed IPC layer with **three** primitives including **subscription + batching +
  backpressure**,
- a `DebugContextStore` with **snapshot/delta streaming**,
- a **module SDK** (`FeatureModule`/`ModuleContext`) **plus a conformance test kit**,
- a **throwaway example module** whose only job is to prove the SDK... which we then
  delete.

This is designing abstractions for requirements we haven't felt yet — textbook YAGNI.

- **Batching/backpressure/deltas (ADR-0006)** exist to tame high-volume streams (TR-6).
  There are **no streams at M0.** The first real stream is logs, in M2. Designing the
  delta protocol now means designing it _blind_ — we even admitted this in OQ-13
  ("prototype in the first streaming feature"). So build query+command now; add the
  subscription primitive **when logs create the actual need.**
- **The module SDK + conformance kit before any real module** is an abstraction
  extracted from **one** speculative example, not from real duplication. The honest
  test of extensibility isn't a throwaway module — it's adding the **second real
  feature** cheaply. By the rule of three, extract the module contract in M2 once we
  have `metro`/`devices`/`logs` showing us the _real_ shared shape. Building the SDK
  first risks encoding the wrong contract and then retrofitting every module to it.
- **The "add a module in < 1 day" success metric** measured against the throwaway
  example is **circular and gameable** — we'd be measuring the ease of using an
  abstraction against the very example we built to fit it. Replace it with "adding the
  _second real_ feature required no core changes," measured for real in M2.

**Correction:** M0 becomes a **walking skeleton** — the thinnest vertical slice that
proves the toolchain, the security boundary, and one real command round-trip — plus the
genuinely-needed low-level primitive (`ProcessManager`). Defer the framework until a
second real consumer justifies it.

---

## 2. Assumptions challenged (the rest)

| # | Assumption in the docs | Challenge | Resolution |
|---|------------------------|-----------|------------|
| A-1 | "Shell-agnostic core" makes an Electron→Tauri move cheap (ADR-0002/TR-7 hedge) | **Partly illusory.** The core (pure Node/TS) does survive, but a Tauri move still rewrites the IPC/preload layer and requires hosting Node as a sidecar. The hedge protects _business logic_, not the _shell integration_ — which is a meaningful chunk. | Keep the hedge but **downgrade the claim**: it de-risks core logic portability, not "cheap migration." Honesty over comfort. Recorded in ADR-0002 follow-up. |
| A-2 | Electron is right because "the RN ecosystem is Node" | Holds up. Metro, CDP clients, RN DevTools frontend are all Node. Tauri would need a Node sidecar anyway. **Confirmed** — but this makes the "footprint" downside the only real cost, and NG-8 already accepts it. | Keep. Strengthen ADR-0002's rationale with the sidecar point. |
| A-3 | Monorepo with ~8 packages from day one | **Over-structured for a walking skeleton.** The one boundary that earns its keep immediately is `core` (Electron-free) vs `desktop` (the shell). `ipc`, `module-sdk`, and five config packages are ceremony before they're load-bearing. | Start with **3 packages** (`core`, `desktop` app, shared `tsconfig/eslint`), split out `ipc`/`module-sdk` when a second consumer appears. pnpm workspace stays (cheap); package count shrinks. |
| A-4 | AI is cleanly deferrable to M3 | Mostly true, but risky in one way: the DebugContextStore is "the moat," yet we won't validate its shape against a real AI consumer until M3. If we design it wrong, every feature writes to a store the AI can't use. | Add a **cheap probe** in M1/M2: serialize a store snapshot and hand it to an LLM once, informally, to sanity-check the shape. Don't build M3; just de-risk the store's design. |
| A-5 | Expo vs bare RN is a detail (barely mentioned) | **Hidden risk.** Expo and bare RN launch Metro and expose the inspector differently; Expo Go vs dev-client vs bare change the picture again. This directly affects the CDP spike and project detection. | Make the spike **explicitly test both** a bare-RN and an Expo dev-client app. Elevate to a first-class open question (new OQ-20). |
| A-6 | Writing a full release-strategy + CI/CD + versioning doc in Phase 0 is good planning | **Mild process theater.** We authored a release/notarization/auto-update plan before proving anyone wants the tool or that CDP works. That's effort spent on the far end of a funnel whose entrance is unvalidated. | Keep the docs (they're cheap and the user asked), but **treat later-milestone docs as thin and provisional**; don't invest more in them until M2. Flagged, not deleted. |

---

## 3. Hidden risks the original plan under-weighted

- **HR-1 — Metro inspector discovery & lifecycle.** The docs assume we can find and
  attach to the inspector, but never address: port discovery, multiple projects/Metro
  instances, Metro restarts invalidating targets, and reconnection. This is real
  engineering the spike must expose. **Add to spike scope.**
- **HR-2 — Expo variance (A-5).** As above — could turn a "CDP works" into "CDP works
  for bare RN only," which materially changes the addressable market (OQ-3).
- **HR-3 — Multi-client CDP contention (OQ-14).** If Icarus attaching **evicts** the
  user's own DevTools (or vice-versa), the UX is broken in a way that's invisible until
  someone hits it. The spike must test "connect while DevTools is also open."
- **HR-4 — The store is a single-writer bottleneck by design.** Centralizing all
  context in one `DebugContextStore` is the moat, but also a single point of contention
  and a serialization hotspot for the AI snapshot. Not a reason to abandon it — a reason
  to **not over-invest in its delta protocol before we've measured real write rates.**
  (Reinforces F-2.)
- **HR-5 — Solo/small-team throughput vs. even the reduced plan (PR-4).** Even the
  corrected M0 is a lot. The walking-skeleton framing helps, but we should be willing to
  let the first real feature (logs) be **somewhat un-abstracted** and refactor later.

---

## 4. Simplification opportunities (net scope removed)

1. **Drop the IPC subscription/batching primitive from M0.** Ship query + command only.
   (−1 L task, −real complexity.) Add streaming when logs need it.
2. **Drop the module SDK + conformance kit + example module from M0.** Extract the
   module contract in M2 from real features (rule of three). (−~1 Epic of speculative
   framework.)
3. **Drop `DebugContextStore` delta/snapshot machinery from M0.** A plain typed
   in-memory store is enough until there's a stream. (Defer OQ-13 as already planned.)
4. **Collapse the package count** from ~8 to ~3 initially (A-3).
5. **Fold `ProcessManager` + `doctor` into the foundation milestone** — they're
   genuinely needed for the first real loop and are lower-risk than the framework we're
   cutting, so they belong in the base, not a separate later milestone.

Net effect: the first milestone gets **smaller and more real** — a running app that does
_one true thing_ end-to-end — while the highest risk gets tested _first_.

---

## 5. Rewritten roadmap (summary — full version in Milestones v2)

| New | Was | Change |
|-----|-----|--------|
| **M0 · CDP Spike (gate) + Walking Skeleton + ProcessManager + doctor** | M0 (big foundation) + M1 (spike) | Spike moves **first & standalone**; foundation shrinks to a walking skeleton; ProcessManager/doctor fold in. |
| **M1 · First useful loop (run app + unified logs)** — _extract the module abstraction here, from real features_ | M2 | Module SDK, IPC subscription, store deltas are built **here**, driven by real need. |
| **M2 · AI thin slice grounded in context** | M3 | Unchanged in intent; store shape informally probed earlier (A-4). |
| **M3+ · Additive integrations (evidence-ordered)** | M4+ | Unchanged. |

The gate discipline is now **structural**: nothing of size gets built until the spike
answers OQ-4. If the spike says "no," we replan around an in-app agent (ADR-0008 Option
B) having spent days, not a milestone.

---

## 6. Proposed follow-up ADRs

- **ADR-0009 — Defer streaming/module-SDK abstractions until a second real consumer
  (rule of three).** Codifies F-2 so a future contributor doesn't "helpfully" build the
  framework early again.
- **ADR-0002 amendment** — soften the portability claim (A-1); add the Node-sidecar
  point (A-2).
- New open questions: **OQ-20** (Expo vs bare RN inspector behavior), and promote HR-1/
  HR-3 into the spike's explicit scope.

---

## 7. What I did _not_ change (still endorse)

- **Context-as-the-product** and a single `DebugContextStore` as the moat — correct and
  worth protecting. The critique is about _when_ to build its machinery, not _whether_.
- **Hardened Electron / typed-validated IPC boundary (ADR-0004)** — non-negotiable from
  commit one; keep exactly as written.
- **Core must be Electron-free** — keep the lint-enforced boundary; it's the one piece of
  "framework" that pays for itself immediately.
- **Plan-before-code and the Epic retrospective ritual** — keep. This review is that
  ritual working as intended.
