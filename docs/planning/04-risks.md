# 04 — Risks (Product & Technical)

Each risk has: a description, likelihood × impact (L/M/H), an owner discipline, and a
mitigation. We separate **product risks** (will anyone want/use it?) from **technical
risks** (can we build it reliably?). We do not hide the scary ones.

Likelihood/Impact scale: **L** low, **M** medium, **H** high.

---

## Product risks

### PR-1 — The fragmentation pain isn't sharp enough to switch tools
- **L×I:** M × H
- Developers tolerate fragmentation with muscle memory; a new tool must be
  dramatically better to overcome switching cost.
- **Mitigation:** Validate with 5–8 design partners _before_ heavy feature build
  (M1). Lead with the one loop that is unambiguously better (unified logs + AI).
  Track [Success Metric](03-success-metrics.md) "stops keeping a separate terminal."

### PR-2 — "Claude Code for RN" sets an expectation the AI can't yet meet
- **L×I:** M × M
- The tagline promises a lot. A weak first AI experience could poison perception.
- **Mitigation:** Sequence AI _after_ real context exists (G-6). Under-promise in
  early builds; frame the assistant as "grounded helper," not "autonomous agent"
  (NG-6). Ship AI only when it can answer with data the user didn't paste.

### PR-3 — The ecosystem shifts under us (RN/Expo tooling changes)
- **L×I:** M × M
- RN's tooling has churned historically (Flipper's deprecation being the cautionary
  tale).
- **Mitigation:** Build on the _official_ direction (CDP / RN DevTools), not a
  proprietary plugin system (NG-2). Keep integrations behind our own stable internal
  contract so an upstream change is contained to one module.

### PR-4 — Solo/small-team bandwidth vs. an 18-integration ambition
- **L×I:** H × M
- The vision is enormous; the risk is spreading thin and finishing nothing.
- **Mitigation:** Ruthless milestone scoping (M0–M2 are foundation + one loop only).
  Non-Goals (02) exist precisely to protect focus.

---

## Technical risks

### TR-1 — Driving the CDP inspector as a third party is harder than assumed
- **L×I:** ~~H × H~~ → **L × M** — **largely retired** by the M0 spike (2026-07-25).
- **Resolved by the spike** ([report](../engineering/reports/cdp-spike-report.md)):
  third-party CDP via Metro's inspector proxy **works live** across four real apps, with
  zero app changes, for Runtime/Log/Debugger/Console and **Network on RN ≥ 0.76**. The one
  scary blocker (a 401 on modern RN) was a standard **Origin CSRF check**, solved with an
  `Origin: http://localhost:<port>` header (sanctioned, not a bypass).
- **Residual (now bounded, not existential):**
  - Coexistence needs a **multiplexing proxy** (Hermes = one connection) — real M1 work,
    proven necessary.
  - **HeapProfiler/Profiler and RN-semantics** need an **in-app bridge** (hybrid) — see
    [ADR-0008](../adr/ADR-0008-debugger-protocol-cdp.md).
  - **Version sensitivity** (Network needs RN ≥ 0.76) and **`dev-middleware` Origin
    allowlist drift** (OQ-21) must be tracked; **target selection + timeouts** are
    required (secondary runtimes like Reanimated are unresponsive).
- These residuals are ordinary engineering carried into M1, not a go/no-go risk.

### TR-2 — Child-process lifecycle correctness across OSes
- **L×I:** M × H
- Orphaned Metro/emulator processes, zombie adb servers, and signal handling differ
  across macOS/Windows/Linux. Getting teardown wrong erodes trust fast.
- **Mitigation:** A dedicated `ProcessManager` core module with an explicit lifecycle
  contract, soak tests (metric: 0 orphans / 50 runs), and OS-specific teardown
  strategies isolated behind one interface. (See [Architecture](../engineering/05-architecture.md).)

### TR-3 — Electron security & the "we spawn shells and talk to the network" surface
- **L×I:** M × H
- We run untrusted-ish local tooling, spawn processes, and (later) send debug context
  to an LLM. Electron misconfigurations (nodeIntegration in renderer, unvalidated IPC)
  are a classic RCE vector.
- **Mitigation:** Security posture is a **first-class ADR**
  ([ADR-0004](../adr/ADR-0004-security-model.md)): context isolation on, no node in
  renderer, a strictly typed & validated IPC allowlist, CSP. Security review is part
  of the Definition of Done for the IPC and process-spawning Epics.

### TR-4 — Cross-platform native toolchain assumptions (adb / xcrun / emulators)
- **L×I:** M × M
- iOS tooling is macOS-only; Android SDK paths vary; users have wildly different
  environments.
- **Mitigation:** An environment-detection/"doctor" capability early (find/validate
  adb, xcrun, node, watchman). Fail loudly and helpfully, never silently. macOS-first
  (NG-7) reduces the matrix initially.

### TR-5 — AI context can leak sensitive data (source, tokens, PII in logs)
- **L×I:** M × H
- Debug context (logs, network bodies, storage) can contain secrets. Sending it to an
  LLM is a data-exfiltration risk.
- **Mitigation:** Data-handling is designed before the AI Epic: explicit, visible
  "what gets sent" boundary; redaction pass; local-first / bring-your-own-key options
  as an [Open Question](99-open-questions.md) (OQ-6, OQ-7). Nothing leaves the machine
  without the user's understanding.

### TR-6 — IPC / state model doesn't scale to high-volume streams (logs, network, perf)
- **L×I:** M × M
- Naive IPC that ships every log line individually across the process boundary will
  jank the UI under load.
- **Mitigation:** Design the IPC/state layer for _streaming and batching_ from day
  one (backpressure, windowed buffers), even though M0 only carries a trickle. Load-
  test the log pipe as an explicit task.

### TR-7 — Choosing Electron may prove wrong for perf-critical paths later
- **L×I:** L × M
- If footprint/perf becomes a real adoption blocker, we may need Rust sidecars or a
  Tauri migration.
- **Mitigation:** Keep OS/process/protocol logic in a **shell-agnostic core** so a
  future move doesn't require rewriting business logic. Documented as a consequence in
  [ADR-0002](../adr/ADR-0002-desktop-shell-electron-vs-tauri.md).

---

## Risk review process

Risks are living. They are re-scored at every **Milestone boundary** and any new risk
discovered mid-Epic is added immediately (not deferred to the next review). TR-1 in
particular gates the roadmap: if the M1 spike fails, we stop and replan.
