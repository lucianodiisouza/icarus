# 20 — M0 Primitives Plan: ProcessManager (E-06) & Doctor (E-07)

- **Milestone:** M0, Track B (alongside the [Walking Skeleton / Epic 1](18-epic-01-plan.md))
- **Why these two now:** they are the only *non-framework* primitives the first useful
  loop genuinely needs, and both are **lower-risk than the abstractions we deferred**
  (ADR-0009). They live in the Electron-free `core` (ADR-0002), so they're fast to build
  and test without a desktop shell.
- **Relationship to Epic 1:** Epic 1's first real command is `doctor.check` — so E-07
  and Epic 1 are coupled at the wiring point (Epic 1 task 13). E-06 is independent and
  can proceed in parallel; nothing in M0 *renders* it yet, but M1's `metro`/`devices`
  modules depend on it, and building it now with a soak test is the cheapest time to get
  the lifecycle correct (TR-2).

> Sizes: S ≤ ½ day · M 1–2 days · L 3–5 days. Everything here is `core`-internal (no
> Electron imports — lint-enforced).

---

## Part A — E-06 · ProcessManager

### Goal

The single, trustworthy way anything in Icarus spawns and controls an OS process
(Metro, emulators, `adb`, `simctl`). Owns the **full lifecycle** with a hard guarantee:
**Icarus never leaves orphaned child processes** (G-2, TR-2). No feature or module ever
calls `child_process` directly (Coding Standards).

### Why it's high-value / high-risk

Almost every future integration is, underneath, "manage a process." Getting teardown,
signals, and cross-OS behavior right *once* here means every module inherits
correctness. Getting it wrong means zombie Metro instances, held ports, and eroded trust
— the classic reason people distrust a dev tool. This is the one M0 primitive we build
to a **soak-tested** bar.

### Design contract (what we're building to)

A `ProcessManager` that hands out `ManagedProcess` handles. The public surface, roughly:

```
ProcessManager
  spawn(spec: ProcessSpec): ManagedProcess      // register + start under supervision
  list(): ManagedProcess[]
  get(id): ManagedProcess | undefined
  disposeAll(): Promise<void>                    // guaranteed teardown of everything

ProcessSpec   { id?, command, args, cwd, env, // launch
                shutdown?: { signalSequence, graceMs }, // how to stop it
                readyWhen?: (line) => boolean }  // optional readiness probe

ManagedProcess (handle)
  id, pid, state: 'starting'|'ready'|'running'|'stopping'|'exited'|'errored'
  stdout / stderr : line stream (bounded, backpressure-aware)
  waitReady(): Promise<void>
  stop(opts?): Promise<ExitInfo>                 // graceful → escalate → force
  onStateChange(cb), onExit(cb)
```

Design decisions baked in:
- **Bounded, backpressure-aware output streams** (not unbounded buffers) — TR-6
  discipline applied even though M0 has low volume.
- **Escalating shutdown**: graceful signal → grace period → force kill, per-OS.
- **State machine, observable** — every transition is emitted (feeds `EventBus` later).
- **Idempotent teardown** — `stop()`/`disposeAll()` safe to call twice.

### Cross-OS teardown strategy (the hard part — TR-2)

macOS-first (NG-7) but built cross-platform-clean behind one interface:
- **macOS/Linux:** spawn in a **detached process group**; on stop, signal the *group*
  (negative PID) so children of Metro (workers) die too — the #1 orphan source.
- **Windows (kept clean, not the priority):** no POSIX groups; use a taskkill-tree
  strategy. Isolated behind the same `stop()` so callers never branch on OS.
- **App-exit safety net:** a single `disposeAll()` wired to Electron's `will-quit` /
  process-exit and to SIGINT/SIGTERM, so a normal quit *and* a Ctrl-C both clean up.
  (The renderer/main wiring is the only Electron-adjacent bit — it lives in
  `apps/desktop`, calling the Electron-free core.)

> **Honest limit:** a `SIGKILL`/hard-crash of Icarus itself cannot run cleanup code —
> nothing can. We mitigate, not eliminate: detached process groups mean the OS reaps
> most children, and a **stale-process reaper on next launch** (see T-06.9) catches the
> rest. The soak test measures the *force-quit* path specifically because that's the
> realistic worst case.

### Tasks — E-06

| # | Task | Size | Depends | Notes |
|---|------|------|---------|-------|
| T-06.1 | `ProcessSpec` / `ManagedProcess` / state-machine types in `core/process` | S | core skeleton (Epic 1 T-04*) | Contract first |
| T-06.2 | Basic spawn + state machine + `onStateChange`/`onExit` + unit tests (fake child) | M | T-06.1 | Use a tiny Node "dummy long-lived process" fixture |
| T-06.3 | Bounded, backpressure-aware stdout/stderr line streams + tests | M | T-06.2 | Line-splitting, max-buffer, drop/coalesce policy |
| T-06.4 | `readyWhen` readiness probe + `waitReady()` + timeout + tests | S | T-06.3 | For "Metro is up" later |
| T-06.5 | Graceful→escalate→force `stop()`; per-OS group signaling (macOS/Linux first) | M | T-06.2 | The core teardown logic |
| T-06.6 | Detached process-group spawn; verify children die with the group (integration) | M | T-06.5 | Spawn a parent that forks a child; assert both exit |
| T-06.7 | `disposeAll()` + idempotency + wire to app `will-quit`/SIGINT/SIGTERM | M | T-06.5 | The Electron wiring lives in `apps/desktop` |
| T-06.8 | **50-run force-quit soak test**: spawn N, hard-quit, assert 0 orphans | L | T-06.6, T-06.7 | The E-06 exit criterion; scripted in `tooling/` |
| T-06.9 | Stale-process reaper on next launch (record PIDs/ports; reap leftovers) | M | T-06.7 | Safety net for the un-runnable-cleanup case |
| T-06.10 | Windows teardown strategy behind the same interface (best-effort, deferred-parity) | M | T-06.5 | NG-7: clean but not gated on |

### Definition of Done — E-06

- All lifecycle states observable; `stop()` and `disposeAll()` idempotent.
- **0 orphaned processes across the 50-run force-quit soak test** (macOS; Linux for the
  pure path). This is the hard gate.
- Output streams are bounded (proven by a test that floods stdout).
- No `child_process` usage exists anywhere outside `ProcessManager` (lint/grep check).
- `core/process` has zero Electron imports; unit + integration tests pass without a
  desktop shell.

### Risks — E-06

| Risk | Mitigation |
|------|------------|
| Orphaning via Metro's own child workers | Detached process **groups**, signal the group; the soak test specifically forks a grandchild. |
| Force-quit can't run cleanup | Accepted & mitigated by process groups + next-launch reaper (T-06.9); soak test measures this path. |
| Windows behaves differently | Isolated behind `stop()`; macOS-first per NG-7; Windows is best-effort now. |
| Flaky timing in tests | Deterministic fixtures + fake timers; assert on state events, not sleeps (Doc 14). |

---

## Part B — E-07 · Environment Doctor

### Goal

Detect and validate the local toolchain Icarus depends on, and **fail loudly and
helpfully** — never silently (TR-4, Coding Standards). Answers US-08. This is also
Epic 1's first real end-to-end capability (`doctor.check`), chosen because it's useful
*and* independent of the CDP spike outcome.

### What it checks (M0 scope, macOS-first)

| Tool | Why Icarus needs it | Check |
|------|---------------------|-------|
| **node** | runs Metro & our tooling | present, version ≥ floor, path |
| **watchman** | Metro file watching (recommended) | present, version, path (warn-not-fail if absent) |
| **adb** | Android device/log/CDP transport later | present, version, path, `adb` server reachable |
| **xcrun / simctl** | iOS simulators (macOS-only) | present (macOS), `simctl` responds |
| *(informational)* **Metro reachable?** | discovery for the CDP spike/M1 | probe default ports 8081 / 19000–19002 (report only) |

Each result is a typed record: `found | not-found | wrong-version | error`, plus
version, resolved path, and an **actionable message** ("watchman not found — `brew
install watchman`"). Honesty rule: report `unknown` rather than guess.

### Design contract

```
Doctor.check(): Promise<DoctorReport>
DoctorReport { generatedAt, platform, checks: DoctorCheck[] , overall: 'ok'|'warn'|'error' }
DoctorCheck  { id, label, status, detail?, version?, path?, remedy?, severity: 'required'|'recommended'|'info' }
```

- **`required` vs `recommended` vs `info`** severity drives `overall` (a missing
  *recommended* tool is `warn`, not `error`).
- Detection is **best-effort and side-effect-free** (spawns short-lived `--version`
  probes via `ProcessManager` — dogfooding E-06 for one-shot commands, which is a nice
  early integration test of both).
- Pure/deterministic core: the OS-probing calls are injected so the logic is unit-
  testable with fakes.

### Tasks — E-07

| # | Task | Size | Depends | Notes |
|---|------|------|---------|-------|
| T-07.1 | `DoctorReport`/`DoctorCheck` types + severity→overall roll-up + tests | S | core skeleton | Pure logic, easy TDD |
| T-07.2 | Tool-probe abstraction (`which` + `--version` via `ProcessManager`), injectable | M | T-06.2 | One-shot command path; fakeable |
| T-07.3 | node + watchman checks (version floors, remedies) + tests | S | T-07.2 | |
| T-07.4 | adb check (present, version, server reachable) + tests | M | T-07.2 | Graceful when Android SDK absent |
| T-07.5 | xcrun/simctl check (macOS-gated) + tests | M | T-07.2 | Skip cleanly on non-macOS |
| T-07.6 | Metro port probe (informational; 8081 / 19000–19002) + tests | S | T-07.2 | Feeds CDP spike/M1 discovery |
| T-07.7 | Compose `Doctor.check()`; actionable remedy copy; `overall` roll-up | S | T-07.3–6 | |
| T-07.8 | Wire `doctor.check` command end-to-end + result screen (**= Epic 1 T-14**) | M | Epic 1 T-11/12, T-07.7 | The shared wiring point |

> T-07.8 **is** Epic 1's task 14 — listed in both plans deliberately so neither pretends
> the other doesn't exist. It's done once, satisfying both DoDs.

### Definition of Done — E-07

- `Doctor.check()` returns a typed report for node/watchman/adb/xcrun with version, path,
  status, and an actionable remedy on failure; macOS-first, degrades cleanly elsewhere.
- Never throws on a missing tool — reports `not-found`/`unknown` instead (tested).
- Rendered end-to-end in the app via `doctor.check` (shared with Epic 1).
- `core` (doctor logic) has zero Electron imports; logic unit-tested with injected fakes.

### Risks — E-07

| Risk | Mitigation |
|------|------------|
| Tool paths/versions vary wildly across machines | Best-effort + honest `unknown`; resolve via `which`/`PATH`; report the path we used. |
| adb/xcrun absent breaks the check | Each check is isolated; absence is a *finding*, not a crash (severity-scoped). |
| Version-floor guesses are wrong | Keep floors as named constants with a comment; easy to adjust; `recommended` where unsure. |

---

## How E-06 and E-07 fit the M0 exit criteria

- E-06's soak test satisfies the milestone's **"0 orphaned processes across a 50-run
  force-quit soak"** exit criterion (Milestones v2, M0).
- E-07 satisfies **"`doctor` detects/validates node, watchman, adb, xcrun"** and doubles
  as Epic 1's proof that a *real* capability crosses the full validated IPC boundary.
- Both live in the Electron-free `core`, reinforcing the one boundary we enforce from
  day one (ADR-0002) — and E-07 dogfoods E-06, so their integration is exercised early.

## Sequencing note

E-06 T-06.1→T-06.5 should land before E-07 T-07.2 (which spawns probes through it). A
pragmatic order: Epic 1 toolchain/shell/IPC → E-06 spawn+stop core → E-07 checks →
shared wiring (Epic 1 T-14 / E-07 T-07.8) → E-06 soak test → M0 retrospective ritual.
