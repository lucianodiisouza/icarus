# 14 — Testing Strategy

Our testing philosophy follows directly from the architecture: the **core primitives are
where correctness matters most** (process lifecycle, IPC boundary, the context store),
because everything else is built on them. We test for _confidence and safety_, not for a
coverage number. Coverage theater is explicitly discouraged (see anti-metrics in
[Success Metrics](../planning/03-success-metrics.md)).

## The testing pyramid (as applied to Icarus)

```
        ▲  few    E2E (Playwright-for-Electron): app launches, real IPC round-trip,
       ╱ ╲        core loops work in the assembled app
      ╱───╲       Integration: ProcessManager against real child processes;
     ╱     ╲      module ↔ core ↔ IPC wired together; log pipe under load
    ╱───────╲     Unit (many): core logic, IPC contracts/validation, store
   ╱_________╲    deltas, module conformance — fast, isolated, deterministic
```

## Layers

### Unit tests (Vitest) — the bulk
- **What:** pure logic in `core` (EventBus, DebugContextStore deltas, Config schema),
  IPC contract validation, per-module logic.
- **Why here:** `core` is Electron-free by design (ADR-0002/0007), so it's fast and
  trivial to unit-test without a desktop shell — a direct payoff of the architecture.
- **Bar:** meaningful assertions on behavior and edge cases. **`core` has a coverage
  gate (≥ 80% lines)** as a floor, but reviewers judge assertion quality, not the
  number.

### Integration tests
- **ProcessManager against real processes** (TR-2): spawn a dummy long-lived process,
  assert health/log-capture, then assert **guaranteed teardown**. Includes the
  **50-run force-quit soak test** (0 orphans) — an explicit exit criterion for E-06.
- **Module ↔ Core ↔ IPC**: register the example module, drive a command through the IPC
  router, assert a store slice updates and a subscription delta is emitted.
- **Log-pipe load test** (TR-6): a synthetic high-rate producer must not jank; asserts
  batching/backpressure from ADR-0006 actually bounds memory and event volume.

### End-to-end (Playwright-for-Electron)
- **Smoke (from M0):** app launches, window renders, one query + one command +
  one subscription complete across the real process boundary.
- **Core loop (from M2):** open a project → Metro starts → device launches → logs appear.
  Kept few and high-value; E2E is slow and flaky-prone, so it guards _critical journeys_,
  not details.

## Security & boundary testing (first-class, not optional)

- **Automated assertions** that the Electron hardening flags are set (contextIsolation,
  no nodeIntegration, sandbox, CSP) — ADR-0004, task T-02.5. A regression here fails CI.
- **IPC allowlist/negative tests:** unregistered channels and malformed payloads are
  rejected. Consider light **fuzzing** of IPC input as the boundary grows.
- **Boundary lint as a test:** the "no Electron in core" rule is verified in CI (it's a
  correctness property, not a style nicety).

## Module conformance kit

Every feature module must pass a shared **conformance test kit** (E-05, T-05.3): it
verifies the module implements `init/dispose` correctly, cleans up on dispose (no leaked
processes/subscriptions), only touches its scoped `ModuleContext`, and declares its IPC
channels/store slices. This is how we keep G-1 honest as modules multiply.

## What we deliberately don't over-test (now)

- **UI pixel/visual regression:** deferred until there's a stable design system (OQ-12).
  Early UI churns too fast for pixel tests to pay off.
- **Cross-platform matrix in full:** macOS-first (NG-7). We run CI on macOS primarily,
  add Linux for pure-logic packages, and expand the matrix when Windows/Linux become
  committed targets. Stated openly rather than pretending to test everywhere.
- **The CDP spike code:** it's disposable (E-Spike-CDP); we test the _learnings_, not the
  throwaway.

## Tooling

- **Vitest** — unit + integration (fast, TS-native, Vite-aligned with ADR-0005).
- **Playwright** (Electron support) — E2E.
- Deterministic tests only: no reliance on wall-clock timing or network flakiness; fake
  timers and local fixtures where needed.

## CI gates (see [CI/CD](15-ci-cd.md))

A PR merges only if: typecheck ✓, lint (incl. boundary rule) ✓, format ✓, unit ✓,
integration ✓, build/package ✓, and `core` coverage floor met. E2E smoke runs on
`main` and release branches (and on PRs touching the shell/IPC).

## Open questions

- OQ-15: how much of the native-tooling integration (real adb/simctl) can be tested in CI
  vs. must be manual/local — decided as those Epics land.
