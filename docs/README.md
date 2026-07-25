# Icarus — RNStudio · Engineering Documentation

> **Working name:** Icarus (RNStudio)
> **Vision in one line:** _"Claude Code for React Native development."_
> **Status:** Planning (Phase 0 — no application code yet)
> **Document owner:** Staff Engineer / Technical Product Manager
> **Last updated:** 2026-07-25

---

## What this is

This directory is the **single source of truth** for the planning and engineering
process of Icarus. The project is greenfield. **No application code exists yet, and
none should be written until Milestone M0 planning is signed off.**

Everything here is written to a simple rule: **every decision states its rationale,
every uncertainty is an Open Question, and we never manufacture false certainty.**

## How to read these docs

Read top-to-bottom for the full story. If you only have five minutes, read
[00 — Vision](planning/00-vision.md), [07 — Milestones](planning/07-milestones.md),
and [05 — Architecture](engineering/05-architecture.md).

### Product & Strategy (`planning/`)

| # | Document | Purpose |
|---|----------|---------|
| 00 | [Vision](planning/00-vision.md) | Why this exists and where it's going |
| 01 | [Product Goals](planning/01-product-goals.md) | What we're committing to |
| 02 | [Non-Goals](planning/02-non-goals.md) | What we're explicitly _not_ doing |
| 03 | [Success Metrics](planning/03-success-metrics.md) | How we know it's working |
| 04 | [Risks (Product & Technical)](planning/04-risks.md) | What could go wrong + mitigations |
| 07 | [Milestones](planning/07-milestones.md) | Phased delivery plan |
| 08 | [Epics](planning/08-epics.md) | Large bodies of work |
| 09 | [User Stories](planning/09-user-stories.md) | Value from the user's POV |
| 10 | [Tasks (M0)](planning/10-tasks.md) | Concrete, estimable work for the first milestone |
| 99 | [Open Questions](planning/99-open-questions.md) | Living register of unresolved decisions |

### Engineering (`engineering/`)

| # | Document | Purpose |
|---|----------|---------|
| 05 | [Architecture Proposal](engineering/05-architecture.md) | System shape, boundaries, data flow |
| 11 | [Folder Structure](engineering/11-folder-structure.md) | Repository layout + rationale |
| 12 | [Coding Standards](engineering/12-coding-standards.md) | How we write code |
| 13 | [Contribution Guide](engineering/13-contribution-guide.md) | How we collaborate |
| 14 | [Testing Strategy](engineering/14-testing-strategy.md) | How we prove correctness |
| 15 | [CI/CD Proposal](engineering/15-ci-cd.md) | How we build, verify, ship |
| 16 | [Release Strategy](engineering/16-release-strategy.md) | How we version and distribute |
| 17 | [Architecture Review #1](engineering/17-architecture-review-2026-07-25.md) | Cold review that corrected the roadmap |
| 18 | [Epic 1 Plan — Walking Skeleton](engineering/18-epic-01-plan.md) | Implementation plan for the first Epic |
| 19 | [CDP Spike Plan (the gate)](engineering/19-cdp-spike-plan.md) | Go/no-go plan for the vision-defining risk |
| 20 | [M0 Primitives Plan — ProcessManager & Doctor](engineering/20-m0-primitives-plan.md) | Task-level plans for E-06 and E-07 |
| — | [Technical Debt Log](engineering/technical-debt.md) | Knowingly-accepted debt + pay-down triggers |

### Architecture Decision Records (`adr/`)

ADRs capture _one decision each_, with context, options, decision, and consequences.
See the [ADR index](adr/README.md).

## The engineering process (non-negotiable)

1. **Plan before code.** No implementation starts until the relevant milestone's
   plan is reviewed.
2. **Incremental delivery.** Work flows Milestone → Epic → Story → Task.
3. **After every Epic completes**, we run a fixed retrospective ritual:
   - Update documentation to match reality.
   - Review the architecture against what we learned.
   - Record technical debt in [the debt log](engineering/technical-debt.md).
   - Propose improvements (as ADRs or backlog items).
4. **Assumptions are explicit.** If we don't know, it becomes an Open Question — not
   a silent guess.

## Assumption disclosure for this whole document set

Because this is Phase 0, the plan rests on assumptions that have **not** been
validated with real users or a real codebase. The most load-bearing ones:

- **A-1:** The primary user is a professional React Native developer on macOS first,
  then Windows/Linux. (See Open Question OQ-1.)
- **A-2:** We can legally and technically embed / drive the React Native DevTools
  frontend and the Metro inspector proxy. (See OQ-4, a hard technical risk.)
- **A-3:** A desktop shell (Electron) is acceptable to the target user despite its
  footprint, because the tool must manage native OS processes (adb, simctl, Metro).
- **A-4:** "AI Assistant" means an LLM-backed assistant that operates _on the
  debugging context the app already gathers_ — not a from-scratch model effort.

These assumptions are tracked and challenged in
[Open Questions](planning/99-open-questions.md).
