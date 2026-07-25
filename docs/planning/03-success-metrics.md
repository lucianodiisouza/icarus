# 03 — Success Metrics

Metrics are split by horizon. We are honest that in Phase 0 we have **no users and no
telemetry**, so early metrics are about _engineering health_, not adoption. We do not
pretend to know product-market fit numbers we cannot yet measure.

> **Instrumentation caveat:** Any usage metric below requires a telemetry decision
> that is an unresolved privacy question (OQ-6). Until that is resolved, usage
> metrics are aspirational and gathered qualitatively (interviews), not automatically.

## Leading indicators — foundation health (measurable now, from M0)

These prove we are "building the project correctly" — the stated first goal.

| Metric | Target | Why it matters |
|--------|--------|----------------|
| Time for a new contributor to add a trivial feature module | < 1 day | Proves the extensibility of the architecture (G-1) |
| CI pipeline wall-clock time | < 10 min | Protects the inner loop (G-8) |
| Test coverage on core (process mgr, IPC, state) | ≥ 80% lines, meaningful assertions | Core must be trustworthy (G-2) |
| Orphaned child processes after force-quit, over a 50-run soak | 0 | Process lifecycle correctness (G-2) |
| Mean local `install → app runs from source` time for a new dev | < 15 min | Onboarding friction |
| Typed IPC coverage (no `any` across the process boundary) | 100% | Boundary safety (G-1) |

## Product-slice indicators (from the first user-facing milestone, M2+)

Measured qualitatively via **design-partner interviews** (target: 5–8 real RN devs,
recruited in M1) until telemetry exists.

| Metric | Target | Signal it represents |
|--------|--------|----------------------|
| Design partners who reach "app running + live logs" unaided | ≥ 80% | G-4 works in the real world |
| Partners who stop keeping a separate `adb logcat`/Metro terminal | ≥ 50% | G-5 delivers real value |
| Task-level SUS-style satisfaction on the core loop | ≥ 4/5 | It's not just functional, it's pleasant |
| Number of distinct RN project setups it works on unmodified | ≥ 4/5 tested | Robustness to real-world variety |

## Lagging indicators — adoption (only meaningful post-beta, deferred)

Explicitly **not** targets we can set credibly today. Listed so we know what we'd
eventually watch:

- Weekly active developers.
- Retention (dev returns in week N+1).
- Fraction of a debug session spent in Icarus vs. other tools.
- AI-assistant queries per active session, and % rated helpful.

We will set concrete numbers for these **only after** the first beta produces a real
baseline. Setting them now would be fake certainty.

## Anti-metrics (things we refuse to optimize for)

- **Feature count.** Shipping all 18 integrations quickly is not success; shipping a
  trustworthy few is. (Guards against violating [Non-Goals](02-non-goals.md).)
- **AI query volume for its own sake.** A helpful assistant that gets asked less
  because the UI already answered the question is a _win_, not a loss.
- **Session length.** Longer sessions may mean the tool is confusing, not sticky.

## Review cadence

Foundation-health metrics are reviewed at the **end of every Epic** (part of the
mandatory Epic retrospective, see [README](../README.md)). Product and adoption
metrics are reviewed at each **Milestone boundary**.
