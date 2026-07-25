# ADR-0001 — Monorepo with pnpm workspaces

- **Status:** Proposed
- **Date:** 2026-07-25
- **Deciders:** Staff Engineer / TPM
- **Related:** G-1 (extensible foundation), G-8 (fast inner loop), ADR-0007 (feature modules)

## Context

Icarus will grow into many independently-developed feature modules plus a shared core,
UI, and cross-cutting packages (types, IPC contracts, tsconfig, eslint config). We need
a repo layout that (a) lets modules share types without publishing to a registry,
(b) enforces boundaries, and (c) keeps the inner loop fast. This is a single-repo
product, not a set of separately-versioned libraries.

## Options considered

### Option A — Single package, folders only
One `package.json`, everything in `src/`.
- **Pros:** Simplest to start; zero tooling.
- **Cons:** No enforced boundaries; the "core must not import Electron" rule
  (Architecture principle 4) becomes a convention, not a constraint; hard to test the
  shell-agnostic core in isolation.

### Option B — pnpm workspaces (monorepo, no build orchestrator yet)
Multiple packages under `packages/` and `apps/`, linked via pnpm workspace protocol.
- **Pros:** Real package boundaries enforce architecture; core/ui/types/modules are
  separately buildable and testable; pnpm is fast and disk-efficient (content-address
  store); type sharing without a registry. Boundary rules become import-level (a
  package simply can't depend on what it doesn't declare).
- **Cons:** More initial setup; contributors must understand workspaces.

### Option C — pnpm workspaces + Turborepo/Nx
As B, plus a task graph/cache layer.
- **Pros:** Cached, parallel builds/tests; scales to many packages.
- **Cons:** Extra concept and config to learn on day one; premature while there are
  ~5 packages.

## Decision

Adopt **Option B: pnpm workspaces** now. Add a build orchestrator (Turborepo) **later**
if/when build times or package count justify it — tracked as a backlog trigger, not a
day-one dependency.

## Rationale

The architecture's core value — a shell-agnostic core and plugin-shaped modules
(G-1) — is only _real_ if boundaries are enforced by the module system, not by
discipline. Workspaces give us that for free. pnpm specifically for speed and its
strict, non-hoisting `node_modules` (which catches accidental phantom dependencies —
exactly the kind of boundary violation we want to prevent). We defer Turborepo (Option
C) to honor G-8 without paying complexity we don't yet need; the migration from B→C is
additive and cheap.

## Consequences

- Positive: architecture boundaries are compiler/resolver-enforced; core is testable
  without Electron; onboarding a module is "add a package."
- Negative / accepted: contributors learn pnpm workspaces; a slightly heavier initial
  scaffold (mitigated by documenting it in the [Folder Structure](../engineering/11-folder-structure.md)).
- Follow-up: define the package boundary lint rules (no `electron` import in `core`)
  and a "when to add Turborepo" trigger (e.g. cold build > 60s or > 12 packages).

## Open questions this leaves

- OQ-10: exact package granularity for feature modules (one package per module vs.
  grouped) — decided when the first real module lands.
