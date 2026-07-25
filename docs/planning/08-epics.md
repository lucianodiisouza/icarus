# 08 — Epics (v2)

> **v2 — reconciled 2026-07-25** to the [Milestones v2](07-milestones.md) roadmap and
> [ADR-0009](../adr/ADR-0009-defer-abstractions-rule-of-three.md).

An Epic is a coherent body of work that delivers a meaningful capability and ends with
the mandatory retrospective ritual. Each Epic below is at **charter level**: goal,
scope (in/out), dependencies, key risks, open questions, and a DoD sketch.

**Two levels of detail, on purpose:**
- **M0 epics are decomposed to task level** — see [Epic 1 plan](../engineering/18-epic-01-plan.md),
  [M0 primitives plan](../engineering/20-m0-primitives-plan.md), and the
  [CDP spike plan](../engineering/19-cdp-spike-plan.md).
- **M1+ epics stop at charter level.** Task decomposition is deliberately deferred until
  the milestone is committed, because M1's real shape depends on the **CDP spike verdict**
  (hybrid CDP-vs-bridge split, Expo support). Writing task lists now would be fake
  certainty that rots. This is the elaboration policy, not laziness — see the note at the
  end.

### Epic ID reconciliation (v1 → v2)

The v1 draft split the foundation into E-01..E-05. v2 collapses the foundation into a
**Walking Skeleton (E-01)** and **defers** the module SDK + IPC streaming to M1 (ADR-0009).
IDs kept where they still carry meaning.

| v2 Epic | Milestone | Was (v1) |
|---------|-----------|----------|
| E-Spike-CDP | M0 · Track A | M1 spike |
| E-01 Walking Skeleton | M0 · Track B | E-01..E-04 (collapsed, slimmed) |
| E-06 ProcessManager | M0 · Track B | M1 |
| E-07 Doctor | M0 · Track B | M1 |
| E-05 Module SDK *(extracted)* | **M1** | M0 |
| E-03s IPC streaming *(deferred)* | **M1** | part of M0 E-03 |
| E-08..E-11 | M1 | M2 |
| E-12..E-13 | M2 | M3 |

---

## Milestone M0 — CDP Spike (gate) + Walking Skeleton + Process Core

### E-Spike-CDP — CDP feasibility spike *(go/no-go gate · Track A)*
- **Goal:** Confirm on our target versions that a third-party tool can drive CDP via
  Metro's inspector proxy, build/measure the multiplexing proxy, and pin the CDP-vs-in-
  app-bridge capability line.
- **DoD:** Written go/no-go report; [ADR-0008](../adr/ADR-0008-debugger-protocol-cdp.md)
  moved to Accepted (likely hybrid) or superseded; OQ-4/5/14/20 resolved.
- **Depends on:** nothing (standalone, disposable). Gates Track B investment.
- **Detail:** fully planned in [Doc 19](../engineering/19-cdp-spike-plan.md).

### E-01 — Walking Skeleton *(Track B)*
- **Goal:** Thinnest real vertical slice: hardened Electron shell + Electron-free `core`
  + typed **query+command** IPC + one genuine command (`doctor.check`) end-to-end, under
  green CI. **No framework we don't yet need** (ADR-0009).
- **In scope:** monorepo/toolchain, hardened shell (ADR-0004), query+command IPC, core
  skeleton (`EventBus`/`Logger`/`Config` + a *plain* typed store), the boundary lint rule.
- **Out of scope (deferred to M1):** IPC subscription/streaming, store deltas, module SDK,
  conformance kit, example module.
- **DoD:** app launches; `doctor.check` crosses the validated boundary; core builds/tests
  without Electron; security baseline asserted in CI; < 15-min onboarding.
- **Detail:** fully planned in [Doc 18](../engineering/18-epic-01-plan.md).

### E-06 — ProcessManager & E-07 — Doctor *(Track B)*
- **Goal:** The two genuinely-needed low-level primitives — guaranteed process lifecycle
  (G-2, TR-2) and an environment doctor (TR-4).
- **DoD:** E-06 — 0 orphans across a 50-run force-quit soak; E-07 — typed, actionable
  toolchain report, never silent-fails.
- **Detail:** fully planned in [Doc 20](../engineering/20-m0-primitives-plan.md).

---

## Milestone M1 — First Useful Loop: Run an RN App + Unified Logs

> M1 is also where we **earn our abstractions from real features** (rule of three,
> ADR-0009): the module SDK and the IPC streaming primitive are built *here*, driven by
> `metro`/`devices`/`logs`, not speculatively in M0.
>
> **Updated 2026-07-25 after the CDP spike.** The transport is now **decided and proven**
> ([ADR-0008](../adr/ADR-0008-debugger-protocol-cdp.md) Accepted): Origin-authenticated
> CDP through Metro's inspector proxy. The spike also promoted two things from "unknown"
> to **concrete M1 components** — a **CDP transport / `ProtocolClient`** (new **E-14**) and
> a **multiplexing proxy** — and confirmed **console + Network are CDP-native** (RN ≥ 0.76),
> which sharpens E-10. The spike's hardened client (Origin header, request timeouts,
> target selection) is a **head start**, not a throwaway.

### E-14 — CDP transport & multiplexing proxy (`ProtocolClient`)  *(new — from the spike)*
- **Goal:** Productionize the spike's disposable client into the Core `ProtocolClients`
  slot: discover targets (`/json/list`), connect with the **`Origin` CSRF header**, select
  the **main JS runtime**, time out unresponsive targets, and front the single Hermes
  connection with a **multiplexing proxy** so Icarus coexists with the user's RN DevTools.
- **Scope:** target discovery + selection, Origin-authed CDP connect, request/event plumbing
  with timeouts, reconnect across app-reload/Metro-restart (**C3**, untested in the spike),
  the multiplexing proxy. **Out:** the in-app bridge (Heap/RN-semantics — see M3+/OQ-22).
- **Depends on:** E-04 Core `ProtocolClients` slot; E-08 (a running Metro to talk to).
- **Key risk:** `dev-middleware` Origin/allowlist drift across RN versions (OQ-21); proxy
  latency/large-payload framing (react-native#56471); version sensitivity (Network needs
  RN ≥ 0.76 — detect & degrade).
- **Open questions:** OQ-21 (mirror/track Origin allowlist; proxy placement); C3 reconnect
  behavior; Android via `adb` (untested in spike).
- **DoD sketch:** connects to a real app as a third party (Origin-authed), survives
  reload/Metro-restart, and the multiplexing proxy lets RN DevTools + Icarus run together.
  Reproduces the spike's evidence as tested, maintained code.

### E-05 — Feature-module contract + conformance kit *(extracted, not invented)*
- **Goal:** Define `FeatureModule` / `ModuleContext` (ADR-0007) **extracted from the real
  shared shape** of the first 2–3 features, plus a conformance test kit.
- **Scope:** the scoped-capability contract, module registry (register/init/dispose),
  conformance kit. **Not** a throwaway example — the real modules are the proof.
- **Depends on:** at least two real modules existing to generalize from (E-08 + one of
  E-09/E-10). Timing is deliberate: extract on the *second* consumer.
- **Key risk:** extracting too early (wrong contract) or too late (duplication pain) —
  mitigated by the rule-of-three trigger.
- **Open questions:** OQ-10 (package granularity per module).
- **DoD sketch:** adding the *second* real feature needs no core changes (the honest G-1
  test); modules pass the conformance kit; ADR-0007 timing reconciled.

### E-03s — IPC streaming/subscription primitive *(deferred from M0)*
- **Goal:** The snapshot+delta **subscription** primitive with batching/backpressure
  (ADR-0006), built against a *real* high-volume stream (logs).
- **Scope:** subscription channel type, delta representation (resolves OQ-13), batching/
  windowing, bounded buffers, renderer-side mirror wiring.
- **Depends on:** E-10 (logs give it a real consumer). Designing it against real volume is
  the whole point of deferring it.
- **Key risk:** TR-6 (high-volume jank) — this epic is the mitigation; load-test is part
  of DoD.
- **Open questions:** OQ-13 (delta representation).
- **DoD sketch:** log stream sustains a synthetic high rate without UI jank; deltas typed
  end-to-end; documented delta-representation decision.

### E-08 — RN project detection & Metro control (`metro` module)
- **Goal:** Detect an RN/Expo project and start/stop/observe Metro via `ProcessManager`.
- **Scope:** project detection (bare RN + Expo — per locked decision), Metro launch/ready
  probe/stop, surfacing Metro status. **Out:** bundling internals, custom Metro config UI.
- **Depends on:** E-06 (ProcessManager); feeds **E-14** the Metro endpoint to attach to.
  Uses the extracted E-05 contract once it exists.
- **Key risk:** Expo vs bare RN launch differences (spike showed the CDP surface is
  identical across clients — differences are RN *version*, not client); Metro port
  discovery (8081 / 8082+ / Expo 19000–19002, confirmed in the spike).
- **Open questions:** largely resolved — OQ-20 answered (client-agnostic); residual is
  version detection (Network needs RN ≥ 0.76).
- **DoD sketch:** starts Metro on a real bare-RN and Expo project; ready detection works;
  clean stop (no orphans, via E-06); exposes the discovered inspector target to E-14.

### E-09 — Device / simulator management (`devices` module)
- **Goal:** Discover and launch iOS simulators / Android emulators; represent them under
  one uniform `Device` type; launch the app on a chosen device.
- **Scope:** enumerate via `simctl`/`adb` (through `ProcessManager`), boot, install/launch
  app. **Out:** physical-device provisioning, deep device settings.
- **Depends on:** E-06, E-07 (doctor confirms toolchain).
- **Key risk:** TR-4 toolchain variance; simctl/adb quirks; macOS-first for iOS (NG-7).
- **Open questions:** OQ-15 (how much is CI-testable vs manual).
- **DoD sketch:** lists + boots a simulator/emulator and launches the app on it on a
  clean-ish machine.

### E-10 — Unified log pipeline (`logs` module)
- **Goal:** Normalize Metro + native (logcat / iOS syslog) + app console logs into typed
  `DebugContextStore` slices; stream to the UI (via E-03s).
- **Scope:** capture from Metro (E-08) + native sources (E-09) + **app console via CDP
  `Runtime.consoleAPICalled`** (proven in the spike — through E-14), normalize to a common
  log record, write store slices. **Out:** advanced analytics.
- **Depends on:** E-08, E-09, E-03s, and **E-14** (console over CDP).
- **Key risk:** TR-6 volume; source-format variance; ordering/interleaving.
- **Open questions:** OQ-9 (persist logs to disk? — informal probe here for A-4).
- **DoD sketch:** unified stream with the three sources; typed store slices; feeds the UI
  without jank.
- **Bonus unlocked by the spike:** **Network is CDP-native on RN ≥ 0.76** (request/response
  events proven). A thin **network capture** can piggyback on E-14 here or seed the first
  M3+ network-inspection epic — the plumbing is the same CDP subscription.

### E-11 — Log UI (search, filter, virtualized)
- **Goal:** The first real user-facing view (G-5): searchable, filterable, virtualized log
  stream reading the store mirror.
- **Scope:** virtualized list, search, source/level filters. **Out:** the broader app
  shell/navigation beyond what this view needs; styling system is chosen here (OQ-12).
- **Depends on:** E-10, E-03s.
- **Key risk:** React re-render/virtualization under high volume (ADR-0005 note).
- **Open questions:** OQ-12 (styling/component/virtualization libs).
- **DoD sketch:** a design partner reaches "app running + live logs" unaided on ≥4/5
  tested setups; view stays responsive under load.

---

## Milestone M2 — AI Assistant Grounded in Context (thin slice)

### E-12 — AI data-boundary & redaction
- **Goal:** Define and implement "what leaves the machine," a redaction pass, and visible
  user control (TR-5); resolve the AI data-handling model as an ADR.
- **Scope:** the explicit send-boundary, redaction of secrets/PII in context, user-facing
  "what gets sent" surface. **Out:** the assistant reasoning itself (E-13).
- **Depends on:** E-10 (real context to reason over).
- **Key risk:** TR-5 data leakage — this epic *is* the mitigation.
- **Open questions:** OQ-6 (telemetry), OQ-7 (local vs API vs BYO-key) — must resolve here.
- **DoD sketch:** what-gets-sent is visible and user-controllable; redaction in place;
  OQ-6/OQ-7 resolved via ADR.

### E-13 — Grounded assistant (thin slice)
- **Goal:** An assistant that reads a `DebugContextStore` snapshot and answers questions
  over it (G-6) — no autonomous device/repo actions (NG-6).
- **Scope:** snapshot serialization for the model, a Q&A surface, answers grounded in
  captured context. **Out:** autonomous actions, code changes, multi-step agents.
- **Depends on:** E-12 (safe boundary first).
- **Key risk:** PR-2 (over-promising the AI) — mitigated by shipping only when it answers
  with data the user didn't paste.
- **Open questions:** carried from E-12 (OQ-7 provider).
- **DoD sketch:** assistant answers using data the user did not manually paste; stays
  within the E-12 data boundary.

---

## Milestone M3+ — Additive Integrations (backlog, unordered)

Network inspection, component tree, storage inspectors (AsyncStorage / MMKV / SQLite),
performance, navigation, native logs, device management, build system — each becomes a
charter-level Epic **when its milestone is committed**, ordered by design-partner
evidence, not guessed now. The CDP spike's **capability matrix** will tell us which are
CDP-native vs need the in-app bridge, which strongly informs their sequencing and cost.

---

## Elaboration policy (unchanged, restated)

**M0 is task-decomposed; M1+ stops at charter level.** When a milestone is committed, its
Epics get decomposed into Stories → Tasks — and only then. This prevents detailed-plan rot
for work whose inputs (especially the CDP spike outcome) are still unknown. The charters
above are stable enough to plan and sequence against, without pretending to a precision we
don't have.
