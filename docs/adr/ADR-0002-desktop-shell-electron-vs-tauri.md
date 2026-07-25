# ADR-0002 — Desktop shell: Electron over Tauri (for now)

- **Status:** Proposed
- **Date:** 2026-07-25
- **Deciders:** Staff Engineer / TPM
- **Related:** G-2 (process/device lifecycle), TR-3 (Electron security), TR-7 (wrong shell later), NG-8 (not optimizing footprint yet)

## Context

Icarus is a desktop app that must **manage native OS processes** (Metro, emulators),
**shell out to CLIs** (`adb`, `xcrun simctl`), and **speak CDP** to Hermes. The
overwhelming majority of the RN toolchain — Metro, the React Native CLI, CDP client
libraries, the RN DevTools frontend — is **Node/JavaScript**. The desktop shell choice
determines how much friction we have integrating that ecosystem, our security surface,
and our footprint.

## Options considered

### Option A — Electron
Chromium + Node.js in the main process.
- **Pros:** Node in the main process is the _native habitat_ of Metro and the RN
  tooling — we can require Metro's packages, use Node CDP clients, spawn processes with
  `child_process`, and potentially reuse the RN DevTools frontend directly. Huge
  ecosystem, mature auto-update (electron-updater), well-trodden security guidance.
- **Cons:** Large footprint (~bundled Chromium + Node); higher memory; security
  requires deliberate hardening (context isolation, no nodeIntegration in renderer —
  TR-3).

### Option B — Tauri
System WebView + Rust backend.
- **Pros:** Much smaller binaries, lower memory, strong security defaults, Rust
  performance for process management.
- **Cons:** The backend is Rust — but our integration targets (Metro, CDP clients, RN
  DevTools) are Node. We'd end up spawning a Node sidecar anyway to host Metro/CDP,
  reintroducing much of Electron's footprint _plus_ a Rust↔Node bridge. System-WebView
  variance across OSes adds UI-consistency risk. Smaller (though growing) ecosystem for
  our niche.

### Option C — Native (Swift/Kotlin per-OS) or a Rust GUI toolkit
- **Pros:** Best performance/footprint.
- **Cons:** Multiplies UI effort per platform; abandons the Node/RN ecosystem
  entirely; wildly premature for a Phase-0 product chasing fit. Rejected outright.

## Decision

Use **Electron** for the foundation and early milestones. Explicitly keep all
OS/process/protocol logic in a **shell-agnostic Core** (Architecture principle 4) so
that a future migration to Tauri or a Rust sidecar is possible without rewriting
business logic.

## Rationale

The dominant early risk is **TR-1 (can we even drive CDP / RN DevTools?)**, and the
dominant early goal is **velocity on a correct foundation (G-1, G-8)**. Both point to
staying where the RN ecosystem already lives: Node. Electron lets us `require` that
ecosystem directly instead of building a Rust↔Node bridge on day one. Tauri's headline
advantage — footprint — is explicitly a **non-goal now** (NG-8) and is partially
eroded for _our_ use case because we'd need a Node sidecar regardless. We pay for this
with a hardening obligation (TR-3), which we accept and address head-on in
[ADR-0004](ADR-0004-security-model.md).

## Consequences

- Positive: frictionless access to Metro/CDP/RN-DevTools; fast start; mature
  auto-update and packaging story.
- Negative / accepted: larger footprint and memory; a real, ongoing security-hardening
  responsibility (context isolation, IPC allowlist).
- Follow-up (TR-7 hedge): enforce "no Electron imports in `core`" via lint; if
  footprint/perf later blocks adoption (evidence, not vibes), a Tauri shell can wrap
  the same Core with the Node-hosting parts moved to a sidecar. This ADR would then be
  superseded.

## Open questions this leaves

- OQ-11: minimum acceptable footprint/memory before we'd treat it as an adoption
  blocker (needs real user feedback to set).
