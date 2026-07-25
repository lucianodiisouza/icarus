# ADR-0003 — TypeScript everywhere

- **Status:** Proposed
- **Date:** 2026-07-25
- **Deciders:** Staff Engineer / TPM
- **Related:** G-1, G-8, ADR-0006 (typed IPC)

## Context

We need one primary language across renderer, main, core, and modules. The choice
interacts with the Electron/Node decision (ADR-0002) and with our need for a **typed
IPC boundary** and shared contracts between processes and packages.

## Options considered

### Option A — TypeScript everywhere
- **Pros:** One language across all tiers; shared type contracts flow through IPC and
  package boundaries (critical for the "100% typed IPC" metric); massive RN/Node
  ecosystem is TS-friendly; refactors across a growing modular codebase are far safer.
- **Cons:** Build/config overhead; types can be circumvented (`any`) without
  discipline (addressed by lint rules in [Coding Standards](../engineering/12-coding-standards.md)).

### Option B — JavaScript (+ JSDoc types)
- **Pros:** No compile step.
- **Cons:** Weaker guarantees exactly where we need them most — the IPC boundary and
  inter-module contracts. Poorer refactor safety as modules multiply.

### Option C — Mixed (Rust/Go for core, TS for UI)
- **Pros:** Performance for the core.
- **Cons:** Contradicts ADR-0002 (stay in Node ecosystem for Metro/CDP); adds a bridge
  and a second toolchain prematurely. Rejected for the foundation; a Rust sidecar
  remains a _future_ option (TR-7) without changing the primary language now.

## Decision

**TypeScript everywhere**, in `strict` mode, with runtime validation (e.g. Zod) at
trust boundaries where compile-time types aren't enough (IPC input, external process
output, config files).

## Rationale

Our architecture's safety rests on typed contracts crossing the process and module
boundaries (G-1). One strict-typed language makes those contracts _the same types_ on
both sides, which is impossible with JS. It also keeps us in the Node ecosystem that
ADR-0002 committed to. Runtime validation covers the gap where types are only a
compile-time promise (untrusted IPC input, messy CLI stdout).

## Consequences

- Positive: shared contracts, safe refactors, one toolchain, alignment with the RN
  ecosystem.
- Negative / accepted: TS/build config to maintain; must actively forbid `any`-escapes
  at boundaries (lint-enforced).
- Follow-up: `tsconfig` base package with `strict: true`, `noUncheckedIndexedAccess`,
  and boundary-validation conventions documented in Coding Standards.

## Open questions this leaves

None material. Rust-sidecar-for-perf remains open under TR-7 but does not affect the
primary-language decision.
