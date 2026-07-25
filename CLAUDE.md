# CLAUDE.md

## Mission

RN Studio aims to become the best debugging environment for React Native developers.

Every feature should reduce debugging friction.

If a feature doesn't make debugging easier, question why it exists.

---

## Engineering Principles

- Simplicity first
- Cross-platform by design
- Plugin architecture
- Offline-first whenever possible
- Fast startup
- Minimal memory footprint
- Observable systems
- AI is an enhancement, never a requirement

---

## Architecture Principles

Prefer:

Composition over inheritance

Interfaces over implementations

Dependency inversion

Feature modules

Small packages

Explicit contracts

No hidden state

---

## Before implementing

Always ask:

Is this the smallest implementation possible?

Can this become a plugin later?

Does this create coupling?

Can we test this?

Will this work on macOS, Windows and Linux?

---

## Coding Rules

No TODO comments.

No dead code.

No commented code.

Tests required for business logic.

No file over 400 lines.

No function over 40 lines without strong justification.

Prefer pure functions.

Document architectural decisions.

---

## Every Pull Request must answer

Why?

How?

Alternatives considered?

Tradeoffs?

Future implications?
