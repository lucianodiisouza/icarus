# ADR-0006 — Renderer↔Main state via snapshot/delta over typed IPC

- **Status:** Proposed
- **Date:** 2026-07-25
- **Deciders:** Staff Engineer / TPM
- **Related:** G-3 (shared debug context), TR-6 (high-volume streams), ADR-0004 (security), ADR-0007 (modules)

## Context

Authoritative state — the `DebugContextStore` — lives in **Main** (it's produced by
process/protocol activity there and must be readable by the AI assistant, also in
Main). The renderer needs to display it in real time. The transport is Electron IPC,
which is a serialization boundary and a trust boundary. Debug data can be **high
volume** (logs, network, perf — TR-6). We must pick how state crosses the boundary
without janking the UI or creating a security hole.

## Options considered

### Option A — Renderer holds authoritative state; Main is a thin RPC
- **Cons:** The AI assistant and modules live in Main and need the authoritative model
  there; putting truth in the renderer forces round-trips and duplicates the model.
  Wrong for our architecture.

### Option B — Authoritative in Main; stream **snapshots + deltas** to renderer *(chosen)*
- Renderer subscribes to a store slice; receives an initial snapshot then batched
  deltas. Renderer keeps a read-only mirror (Zustand). Intents flow the other way as
  validated commands.
- **Pros:** Single source of truth in Main (serves G-3 and the AI reader); natural fit
  for streaming with **batching/backpressure** (directly addresses TR-6); the command/
  query split maps cleanly onto the security allowlist (ADR-0004).
- **Cons:** Need a small delta/patch mechanism and subscription lifecycle.

### Option C — Ship every event individually over IPC
- **Cons:** Guaranteed jank under log/network volume (TR-6). Rejected.

## Decision

**Option B.** A typed IPC layer with three primitives:
1. **Query** (request/response) — read a snapshot.
2. **Command** (intent) — validated, allowlisted mutation request (e.g. "start Metro").
3. **Subscription** (stream) — snapshot-then-deltas for a store slice, **batched and
   windowed** (coalesce N deltas / M milliseconds; bounded buffers with backpressure).

All three are fully typed end-to-end (ADR-0003) and validated at the boundary
(ADR-0004). Modules declare which slices/commands they expose (ADR-0007).

## Rationale

This is the only option consistent with "truth in Main, AI as a co-located reader"
(G-3) while also being the natural shape for taming high-volume streams (TR-6). The
three-primitive vocabulary keeps the boundary small and auditable, which the security
model (ADR-0004) requires. Batching is designed in from day one even though M0 carries
almost no data — because retrofitting backpressure after the log pipe is built is
painful.

## Consequences

- Positive: one source of truth; UI stays responsive under load; boundary is typed and
  auditable; the AI assistant reads the same model as the UI.
- Negative / accepted: a delta/patch and subscription-lifecycle mechanism to build and
  test; must define batching parameters per stream.
- Follow-up: load-test the subscription path with a synthetic high-rate log producer as
  an explicit task in the Logs Epic.

## Open questions this leaves

- OQ-13: exact delta representation (JSON patch vs. domain-specific diffs vs. immutable
  structural sharing) — prototype in the first streaming feature and record the choice.
