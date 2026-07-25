# ADR-0004 — Electron security & the IPC trust boundary

- **Status:** Proposed
- **Date:** 2026-07-25
- **Deciders:** Staff Engineer / TPM
- **Related:** TR-3 (Electron security surface), TR-5 (AI data leakage), G-7 (trustworthy by default)

## Context

Icarus spawns processes, shells out to the OS, talks to local sockets/CDP, renders
content that may include untrusted data (logs, network bodies from the user's app),
and will later send debug context to an LLM. Electron's default-insecure knobs
(nodeIntegration, disabled context isolation, unvalidated IPC) are a well-known remote-
code-execution class. Because the app's whole job is privileged local operations, the
**renderer must be treated as untrusted** and the **Main↔Renderer boundary as a real
trust boundary.**

## Options considered

### Option A — Convenience-first Electron (nodeIntegration on, ad-hoc IPC)
- **Pros:** Fastest to prototype; renderer can call Node directly.
- **Cons:** Any injected string (a malicious log line, a crafted network response
  rendered in the UI) becomes potential RCE. Unacceptable given our data sources.

### Option B — Hardened Electron with a validated IPC allowlist  *(chosen)*
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` where feasible.
- A `preload` script exposes a **small, explicit, typed API** — not raw `ipcRenderer`.
- Every IPC channel is registered in an **allowlist** with a schema; inputs are
  runtime-validated (Zod). Unregistered channels are rejected.
- Strict **Content-Security-Policy**; no remote code loaded into the renderer.
- **Pros:** Closes the RCE class; makes the boundary auditable; forces intentional API
  surface.
- **Cons:** More upfront plumbing; every new capability must be explicitly exposed.

### Option C — Full per-module process sandboxing now
- **Pros:** Strongest isolation.
- **Cons:** Premature (OQ-8); heavy for Phase 0. Deferred.

## Decision

Adopt **Option B** as a non-negotiable baseline from the very first commit that
introduces a renderer or IPC. Security configuration is part of the **Definition of
Done** for the IPC and process-spawning Epics, and a lightweight threat-model note is
required whenever a new IPC channel or process-spawn capability is added.

## Rationale

Our data sources are inherently untrusted (they come from the user's running app and
the network), and our capabilities are inherently dangerous (spawn, shell, sockets).
That combination is exactly the Electron RCE scenario. The cost of Option B is upfront
plumbing we were going to build anyway (typed IPC — ADR-0006); the cost of getting it
wrong is a tool that can be turned against its user's machine. There is no reasonable
argument for the convenience path.

## Consequences

- Positive: renderer compromise doesn't grant OS access; IPC surface is auditable and
  minimal; aligns with G-7.
- Negative / accepted: each capability must be deliberately exposed and validated; more
  boilerplate (mitigated by a typed IPC helper).
- Follow-up: define the redaction/"what gets sent to the AI" boundary before the AI
  Epic (TR-5); add IPC-fuzzing to the test strategy for boundary robustness.

## Open questions this leaves

- OQ-6 / OQ-7: telemetry and AI data-handling (what may leave the machine, and how the
  user controls it). Must be resolved before the AI Epic ships.
- OQ-8: per-module process isolation (deferred).
