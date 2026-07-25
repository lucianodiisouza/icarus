# ADR-0009 — Defer streaming & module-SDK abstractions until a second real consumer

- **Status:** Proposed
- **Date:** 2026-07-25
- **Deciders:** Senior Staff Engineer (Architecture Review #1)
- **Related:** ADR-0006 (IPC/streaming), ADR-0007 (feature modules), Review F-2, G-1, G-8, PR-4

## Context

The v1 M0 plan built, before any real feature existed: the IPC subscription/batching
primitive, `DebugContextStore` snapshot/delta streaming, the `FeatureModule`/
`ModuleContext` SDK, a conformance test kit, and a throwaway example module to exercise
the SDK. [Architecture Review #1](../engineering/17-architecture-review-2026-07-25.md)
found this to be speculative generality: abstractions designed for requirements not yet
felt, extracted from a single _invented_ example rather than real duplication.

## Options considered

### Option A — Build the framework up front (v1 plan)
- **Pros:** The abstraction exists the moment the first real feature arrives.
- **Cons:** High risk of encoding the _wrong_ contract (we'd design the delta protocol
  and module surface blind — OQ-13 literally says "prototype in the first streaming
  feature"); then every feature is retrofitted to a contract that didn't learn from real
  use. Slows the foundation; contradicts G-8 and PR-4 (focus/throughput).

### Option B — Defer abstractions until the second real consumer (rule of three) *(chosen)*
- Build M0's walking skeleton with **query + command IPC** and a **plain typed store**.
- Add the **subscription/streaming** primitive and store deltas **when logs (M1) create
  a real stream** — designed against real volume.
- Extract the **`FeatureModule` contract + conformance kit** in M1, once `metro`,
  `devices`, and `logs` show the **actual** shared shape.
- **Pros:** Abstractions are extracted from real duplication, so they fit; foundation
  ships faster and smaller; the honest extensibility test becomes "adding the _second
  real_ feature needs no core changes."
- **Cons:** The first one or two features carry some un-abstracted/duplicated code
  briefly, and get refactored when the contract is extracted. This is acceptable, cheap
  churn.

### Option C — Never abstract; keep features ad hoc
- **Cons:** Abandons G-1 (extensibility is the whole point of the module architecture).
  Rejected.

## Decision

**Option B.** M0 builds a walking skeleton plus only-what's-needed primitives.
Streaming, store deltas, and the module SDK are built in M1, driven by real features,
following the rule of three (extract on the third occurrence / second real consumer).
The one boundary we _do_ enforce immediately — `core` must not import Electron — stays,
because it pays off from commit one.

## Rationale

Good abstractions are _discovered_ from concrete repetition, not _predicted_. We already
admitted (OQ-13) that we can't choose the delta representation well without a real
stream. Building the framework first optimizes for an imagined future at the cost of the
real, near-term goal: a correct, small foundation and a fast inner loop (G-8) with our
scarce throughput (PR-4). Deferring costs us a little refactoring churn in M1 — a price
worth paying to encode the _right_ contract.

## Consequences

- Positive: smaller, faster M0; abstractions that fit real usage; a non-gameable G-1
  test; less risk of a wrong contract calcifying.
- Negative / accepted: some duplicated/un-abstracted code in the first feature(s) until
  M1 extraction (logged as expected, not as debt).
- Follow-up: when extracting in M1, write the `FeatureModule` contract and reconcile
  ADR-0007's timing; add the conformance kit then.

## Open questions this leaves

- OQ-13 (delta representation) is now correctly resolved _in M1_ against a real stream,
  as intended.
