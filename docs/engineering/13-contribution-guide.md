# 13 — Contribution Guide

How we collaborate on Icarus. The overriding rule mirrors the project process: **plan
before code, deliver incrementally, and keep `main` releasable.**

## Prerequisites

- Node (LTS — exact version pinned via `.nvmrc`/`engines` in M0), **pnpm**, git.
- macOS is the primary dev platform (NG-7). Windows/Linux contributions are welcome and
  must keep code cross-platform-clean, but iOS-related work requires macOS.
- Platform tools (`adb`, `xcrun`, watchman) are needed only for the milestones that use
  them; the `doctor` (E-07) will tell you what's missing.

## First-time setup (target: < 15 min — a tracked metric)

```bash
git clone <repo> icarus
cd icarus
pnpm install
pnpm dev
```

If anything here takes longer than 15 minutes or is unclear, **that is a bug** — open an
issue. Onboarding friction is a first-class quality signal (Success Metrics).

## Branching & workflow

- `main` is always green and releasable. No direct commits to `main`.
- Branch per unit of work: `type/short-desc` (e.g. `feat/ipc-subscription`,
  `fix/process-orphan-teardown`, `docs/adr-0008-update`).
- Keep branches short-lived; rebase on `main` frequently.

## Commits

- **Conventional Commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`,
  `build:`, `ci:`. Scope optional (`feat(ipc): …`).
- Small, logically-atomic commits. The commit message explains _why_, not just _what_.
- Commit hooks run lint-staged; don't bypass them.

## Pull requests

A PR must:
1. Reference the **Task/Story/Epic** it advances (e.g. "Closes T-03.4").
2. Be **small and reviewable**. If it's large, it probably crosses an Epic boundary —
   split it.
3. Have **green CI** (typecheck, lint, format, tests, build). Non-negotiable.
4. Include tests for new logic and update docs when behavior/architecture changes.
5. For anything touching **IPC or process-spawning**, include the security note the DoD
   requires (ADR-0004) and get a maintainer review.
6. Not silently reverse a **Non-Goal** or an **ADR** — those changes need their own ADR.

### Review expectations

- Reviewers check: correctness, boundary rules (Doc 11/12), test quality (assertions,
  not coverage theater), and whether the change respects the architecture.
- Disagreements about a decision are resolved by writing/citing an ADR, not by argument
  in the PR thread.
- Be kind and specific. Review the code, not the person.

## The Epic completion ritual (mandatory)

When an Epic's DoD is met, before starting the next, the driver runs:
1. **Update docs** to match what was actually built (this whole `docs/` tree).
2. **Review the architecture** against what we learned; open an ADR if a decision
   changed.
3. **Log technical debt** in [technical-debt.md](technical-debt.md) — honestly, with
   context.
4. **Propose improvements** as backlog items or ADRs.

This ritual is a required checklist item on the Epic's closing PR. Skipping it is how
plans rot; we don't skip it.

## Decision-making & disagreement

- Architecturally significant decisions → **ADR** (see [adr/](../adr/README.md)).
- Unresolved uncertainty → add to [Open Questions](../planning/99-open-questions.md)
  rather than guessing silently. Manufacturing false certainty is against the culture of
  this project.
- The Staff Engineer / Maintainer breaks ties, but always with written rationale.

## Safety & trust (applies to all contributors)

Icarus takes privileged actions on the user's machine and their app. Contributions must
honor G-7 (trustworthy by default): no silent state mutation, destructive/device actions
are confirmed, and anything that could send user data off-machine (AI, telemetry) is
explicit and controllable (TR-5, ADR-0004). Code that violates this is rejected
regardless of how useful the feature is.

## Definition of Done (per task)

- Code + tests written; CI green.
- Boundary/security rules respected.
- Docs updated if behavior/architecture changed.
- Linked Task/Story updated; if it closes an Epic, the ritual above is done.
