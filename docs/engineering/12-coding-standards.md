# 12 — Coding Standards

Standards exist to make a growing, multi-module codebase _boringly consistent_ so that
review, onboarding, and refactoring stay cheap (G-1, G-8). Where a rule can be enforced
by a tool, it must be — humans shouldn't police what a linter can.

## Language & typing

- **TypeScript `strict: true`** everywhere (ADR-0003), plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`.
- **`any` is banned** in committed code (`@typescript-eslint/no-explicit-any` error).
  Use `unknown` + narrowing. Rare, justified exceptions require an inline
  `// eslint-disable-next-line` **with a reason comment**.
- **Validate at every trust boundary.** Types are compile-time promises; anything
  crossing IPC, coming from a spawned process's stdout, or read from disk/config must be
  **runtime-validated** (Zod) before use. This is a hard rule tied to ADR-0004.
- Prefer **explicit return types** on exported functions and module-public APIs.

## Boundaries (the rules that protect the architecture)

- `core` imports no Electron / no renderer code (lint-enforced; see
  [Folder Structure](11-folder-structure.md)).
- Renderer speaks only `ipc`; never reaches into `core` internals.
- Feature modules touch the outside world only through `ModuleContext` (ADR-0007).
- No cross-module imports of internals. Modules are peers, not a dependency graph.

## Errors & results

- **No silent failures.** Every catch either handles meaningfully or rethrows with
  context. Swallowing an error is a review-blocker.
- Distinguish **expected failures** (a device not found, a tool missing) — model these
  as typed results and surface them helpfully (TR-4 doctor philosophy) — from
  **unexpected bugs** (throw, log, report).
- Errors that reach the user must be **actionable**: what happened, why, what to do.

## Async & processes

- No unhandled promise rejections (lint-enforced).
- Anything that spawns a process goes through `ProcessManager` — never raw
  `child_process` in a module. This is how we guarantee teardown (TR-2, G-2).
- Long-lived streams must support **backpressure / bounded buffers** (TR-6). No
  unbounded in-memory accumulation of log/network data.

## Naming & structure

- Files/dirs: `kebab-case`. Types/classes: `PascalCase`. Vars/functions:
  `camelCase`. Constants: `UPPER_SNAKE` only for true module-level constants.
- One primary export concept per file; keep files small enough to hold in your head.
- Public APIs live in a package's `index.ts`; everything else is internal.
- **Match the surrounding code.** Consistency beats personal preference.

## Comments & docs

- Comment the **why**, not the **what**. Code says what; comments explain intent,
  trade-offs, and non-obvious constraints.
- Every exported module API gets a short TSDoc. Every ADR-relevant decision in code
  links back to its ADR (`// see ADR-0004`).
- Keep comment density consistent with the file you're editing.

## Formatting & imports

- **Prettier** is the single formatter; no style debates in review. `format:check` in
  CI.
- **ESLint** for correctness rules (the ones above). Warnings are not allowed to
  accumulate — CI treats lint errors as failures.
- Import order enforced (external → workspace → relative); no unused imports.

## Testing expectations (summary — full detail in [Doc 14](14-testing-strategy.md))

- Core primitives (`ProcessManager`, `DebugContextStore`, IPC) require unit tests with
  **meaningful assertions**, not coverage theater.
- Every feature module must pass the **conformance test kit**.
- Boundary/security invariants (ADR-0004) are asserted in tests, not just documented.

## Commits & PRs (summary — full detail in [Doc 13](13-contribution-guide.md))

- Conventional Commits. Small, reviewable PRs. Green CI is a merge precondition.

## Enforcement summary

| Rule | Enforced by |
|------|-------------|
| Formatting | Prettier (CI `format:check`) |
| `any` ban, unused, import order, no-floating-promises | ESLint (CI) |
| Core↔Electron boundary | ESLint restricted-imports (CI) |
| Strict typing | `tsc --noEmit` (CI) |
| Boundary validation present | code review + targeted tests |
| Security config | automated assertions (T-02.5) |
