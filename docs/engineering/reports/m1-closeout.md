# M1 Closeout — First Useful Loop: Run an RN App + Unified Logs — 2026-07-25

> The M1 loop is **built, on `main`, and verified running**: detect an RN project →
> start Metro → boot a simulator → auto-attach CDP → one **unified live log** carrying
> app console + Metro output + simulator syslog, searchable and filterable. The quality
> bar (coverage gate, type-aware lint, Electron E2E, security-baseline assertions) is
> enforced in CI. Two of the four formal exit criteria remain **open** and are called out
> below — this is a closeout of the _engineering_, not yet of the _validation_.

## Verdict

**Functionally complete, honestly incomplete on validation.** A developer can open Icarus
today and reach "app running + live logs." The loop was driven end-to-end on macOS (app
boots, `doctor.check` round-trips, unified log shows all three sources, auto-attach
connects). What M1 has _not_ earned yet: a real **design-partner** run on ≥ 4/5 setups,
and the **high-rate load test** that validates TR-6 — because the ADR-0006
streaming/subscription primitive (E-03s) was deferred, not built. Those are the honest gaps
between "the loop works on my machine" and "M1 is done."

## What shipped — the loop

All on `main`, delivered across the M1 epics:

| Epic | What it does |
|---|---|
| E-14 (CDP) | Target discovery + selection, Origin-authed CDP client, multiplexing proxy, live console wiring; auto-reconnect across reload/Metro-restart (C3); Network domain capture with graceful degrade on RN < 0.76 |
| E-08 (Metro) | Detect bare-RN/Expo project, start/stop Metro via `ProcessManager`, capture the listening port, stream output |
| E-09 (Devices) | List / boot / install / launch iOS simulators via `xcrun simctl` |
| E-10 (Unified log) | Fan-in of CDP console + Metro output + iOS simctl syslog into one typed stream with source/level tags |
| E-11 (Log UI) | Search, source/level filter chips, hand-rolled virtualizer |
| E-05 (Module SDK) | `FeatureModule` / `ModuleContext` contract + conformance kit, **extracted from the three real modules** (rule of three), not invented |
| TD-16 (Auto-attach) | Metro-ready + sim-booted → auto CDP connect, with a disconnect-means-stop policy |

## Post-M1 hardening — this session (7 PRs)

The loop existed but had seams. This session closed them and raised the quality bar:

| PR | Item | Effect |
|---|---|---|
| #25 | TD-15 — declarative IPC auto-wiring | Modules declare their `events`; `bindRegistryToWindow` binds them generically. Adding a module needs **no** `createWindow`/preload/contract edits. Fixed a latent bug: the unified-log panel had never received data (its events were never bound to a window). |
| #26 | TD-21 — Metro → unified log | Metro output now fans into the unified stream (`pushMetro` had no caller). |
| #29 | TD-18 — iOS syslog → unified log | `SyslogFanIn` streams the booted sim's syslog on `devices.boot`. The unified log now carries **all three** sources. |
| #28 | TD-10 — coverage gate | `@icarus/core` gated at ≥ 80% (v8), enforced by the existing `pnpm -r test`. Currently 83.7%. |
| #30 | TD-09 — typed lint | Type-aware `no-floating-promises` enabled (scoped to `src/**`). Zero violations — locks in existing discipline. |
| #31 | TD-07 — Electron E2E harness | Playwright `_electron` launches the built app in CI (under `xvfb`) and asserts boot + `doctor.check` round-trip. First display-enabled CI job. |
| #32 | TD-06 — security baseline asserted | Live assertions of `sandbox`/`contextIsolation`/`nodeIntegration`, strict prod CSP (inline script blocked), and the navigation/window-open allowlist. |

## Exit-criteria scorecard (honest)

M1's four exit criteria (`docs/planning/07-milestones.md`):

| # | Criterion | Status |
|---|---|---|
| 1 | Design partner reaches "app running + live logs" unaided on ≥ 4/5 setups | 🟨 **Reachable, unvalidated.** Driven end-to-end on macOS by us; no real design-partner run yet. Needs a design partner — a validation task, not an engineering one. |
| 2 | Log pipe sustains a synthetic high-rate stream without UI jank (validates TR-6) | 🟥 **Not met.** The ADR-0006 streaming/subscription primitive with batching/backpressure (E-03s) was deferred; the log path is one-way `webContents.send` + a hand-rolled virtualizer (E-11). No load test exists. Tracked by **TD-05** and the E-03s deferral. |
| 3 | Module abstraction extracted — adding the _second_ real feature needs no core changes (G-1) | 🟩 **Met, and strengthened.** E-05 extracted the contract from three real modules; TD-15 made event IPC declarative, so a new module is genuinely a one-line registration. |
| 4 | Informal probe: hand a store snapshot to an LLM once, to sanity-check its shape before M2 (A-4) | 🟥 **Not done.** This is an M2 pre-check; deferred to the M2 design step. |

## Test & CI posture

- **236 tests**: 182 `core` unit, 47 desktop unit, 7 Electron E2E (2 smoke + 5 security).
- CI enforces, on every PR: typecheck · lint (incl. the no-Electron-in-`core` boundary rule and typed `no-floating-promises`) · format · unit tests with the `core` coverage gate · build · **and** the Electron E2E job (app-launch + IPC round-trip + security baseline under `xvfb`).
- `core` coverage: **83.7%**, gated at 80% (can only ratchet up).

## Architecture review

The foundation held with **no changes proposed**. The `ProcessManager` + `EventBus` +
`DebugContextStore` triad carried every M1 module unchanged. The ADR-0002 bet — an
Electron-free `core` — paid off repeatedly: `core` is fully unit-testable without a shell
(hence the coverage gate lives there), and every fan-in/composition decision (CDP, Metro,
syslog → unified) sits cleanly at the desktop composition root, not in `core`. The
boundary lint rule caught a deliberate violation during development.

## Open debt carried into M2

Nothing here is a surprise; each has a trigger:

- **E-03s / TD-05** — the streaming/subscription primitive and its high-rate load test
  (M1 exit criterion #2). Deferred because the delta representation (OQ-13) wants a real
  streaming consumer to choose well; the unified log is now that consumer, so this is the
  first thing M2 (or an M1.5 slice) should pick up if log volume becomes a problem.
- **Design-partner validation** — exit criteria #1 and #4 need a real user in the loop.
- Accepted / trigger-gated: Android via `adb` (TD-13), Windows tree-kill parity (TD-12),
  cross-launch orphan reaper (TD-11), Turborepo cache (TD-03), Electron footprint (TD-02),
  in-process module isolation (TD-01).

## M1 → M2 gate

M2 (AI assistant grounded in a `DebugContextStore` snapshot) is **blocked on two product
decisions**, not engineering:

- **OQ-6** — telemetry: collect anything, and how is it consented?
- **OQ-7** — AI provider: local model vs. hosted API vs. bring-your-own-key?

Both must resolve before E-12/E-13 can be designed. Until then, the highest-value
engineering available is the E-03s streaming primitive + load test (closing M1 exit
criterion #2) and, when a design partner is available, the #1/#4 validation runs.
