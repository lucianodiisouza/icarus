# 09 — User Stories

Stories express value from a user's point of view: _As a **persona**, I want **X**, so
that **Y**._ Each has acceptance criteria (AC). In Phase 0 the "user" of the foundation
milestones (M0/M1) is often **the Icarus developer/contributor themselves** — that is
honest, not a cop-out: a correct foundation is the deliverable, and its user is us.

## Personas

- **P1 — Dev (the RN developer):** our eventual end user. Professional, macOS-first,
  Hermes-based app, tired of tool fragmentation.
- **P2 — Contributor:** builds Icarus itself. Cares about a clean, fast, extensible
  codebase.
- **P3 — Maintainer:** reviews, releases, and guards architecture/quality.

---

## M0 — Foundation (primary persona: P2 Contributor)

### US-01 — Predictable, fast setup
_As a **Contributor**, I want to clone and run the app in one documented flow, so that I
can contribute the same day._
**AC:** `pnpm install && pnpm dev` launches the app; a `CONTRIBUTING` flow works on a
clean machine in < 15 min; failures are explained.
_(Epic E-01, E-02; Metric: onboarding time.)_

### US-02 — Enforced architecture boundaries
_As a **Maintainer**, I want the "core must not depend on Electron" rule enforced by
tooling, so that the shell-agnostic hedge (TR-7) can't silently rot._
**AC:** an Electron import in `core` fails lint/CI.
_(Epic E-01, E-04.)_

### US-03 — Safe, typed communication across the process boundary
_As a **Contributor**, I want IPC calls to be typed and validated, so that I can't
accidentally introduce an unsafe or malformed channel._
**AC:** query/command/subscription each have a typed contract; unregistered/invalid
messages are rejected; examples are tested.
_(Epic E-03; ADR-0004, ADR-0006.)_

### US-04 — Add a feature without touching the core
_As a **Contributor**, I want to add a feature module by implementing one contract and
registering it, so that features stay independent (G-1)._
**AC:** the example module adds an IPC command, a store slice, and a UI view with **no
core changes except registration**; a conformance test kit passes.
_(Epic E-05.)_

### US-05 — Trust the security baseline
_As a **Maintainer**, I want the Electron hardening verified in CI, so that we never
regress into an RCE-prone config._
**AC:** automated checks assert context isolation, no nodeIntegration, CSP, IPC
allowlist.
_(Epic E-02; ADR-0004.)_

---

## M1 — De-risk (personas: P2, P3)

### US-06 — Know if the vision is buildable
_As a **Maintainer**, I want a clear go/no-go on CDP feasibility, so that we don't build
M2 on an unproven assumption (TR-1)._
**AC:** a reproducible spike connects to Metro's inspector and returns one real CDP
datum, with a written decision.
_(Epic E-Spike-CDP.)_

### US-07 — Never leak processes
_As a **Dev**, I want Icarus to never leave Metro/emulators running after it exits, so
that my machine stays clean and my ports free._
**AC:** 0 orphans across a 50-run force-quit soak test.
_(Epic E-06; TR-2.)_

### US-08 — Understand my environment problems
_As a **Dev**, I want Icarus to tell me exactly which tool (adb/xcrun/node/watchman) is
missing or misconfigured, so that I can fix setup fast._
**AC:** `doctor` reports presence/version/path and gives actionable fixes.
_(Epic E-07; TR-4.)_

---

## M2 — First useful loop (persona: P1 Dev)

### US-09 — Run my app without a terminal
_As a **Dev**, I want to open my project in Icarus and get it running on a
device/simulator, so that I skip the terminal dance._
**AC:** detect project → start Metro → launch on device, in one flow.
_(Epic E-08, E-09; G-4.)_

### US-10 — One place for all my logs
_As a **Dev**, I want Metro, native, and console logs unified, searchable, and
filterable, so that I stop juggling terminals._
**AC:** unified stream; search + filter; stays responsive under high log volume.
_(Epic E-10, E-11; G-5, TR-6.)_

---

## M3 — AI (persona: P1 Dev)

### US-11 — Ask questions about what my app is doing
_As a **Dev**, I want to ask the assistant to interpret my logs/errors using context it
already has, so that I don't copy-paste into a chat window._
**AC:** the assistant answers using captured context; no manual paste needed.
_(Epic E-13; G-6.)_

### US-12 — Control what leaves my machine
_As a **Dev**, I want to see and control exactly what debug data is sent to the AI, so
that I don't leak secrets (TR-5)._
**AC:** a visible "what gets sent" boundary + redaction; user can restrict it.
_(Epic E-12; G-7.)_

---

## Backlog stories (M4+, not committed)

Network inspection, component tree, storage inspectors, performance, navigation, native
logs, device management, build system — each becomes a story set when its milestone is
committed. Left intentionally undecomposed to avoid fake certainty (see
[Milestones](07-milestones.md) M4+).
