# Changelog

All notable changes to Icarus are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/) (pre-1.0: `0.x` means "foundation,
moving fast").

For the release process, see [`docs/engineering/RELEASE.md`](docs/engineering/RELEASE.md).

---

## [Unreleased]

### Added (since M2 closeout, 2026-07-26)

- **M3 additive inspectors (E-15 through E-20).** Six new inspector panels in the
  renderer, each with a dedicated IPC channel, an Electron-free core piece, and a
  typed test pyramid. The M3 backlog is the "additive integrations" milestone from
  `docs/planning/07-milestones.md`.
  - **E-15** — opt-in unified-log export. "Export N entries" button on the unified
    log panel; writes a JSONL file (redacted, local-only, never transmitted) with a
    user-picked path. M3 canary: a planted secret in captured context is redacted
    in the file output.
  - **E-16** — M3 network inspector. One row per HTTP call, expandable with headers
    + opt-in body fetch (`Network.getRequestPostData` / `getResponseBody`, size-capped,
    timeout-capped). Correlates request/response/failed/finished by the stable
    `requestId`.
  - **E-17** — M3 component tree inspector. Hierarchical view of the running app's
    React components, expandable to see props, with name search (highlights matches
    + keeps ancestors navigable). `Cmd-R` refresh.
  - **E-18** — M3 storage inspectors. Backend selector (AsyncStorage | MMKV) →
    Refresh → list of keys with value previews → click a row to load the full value
    + Delete. Per-row typed errors, no auto-fires.
  - **E-19** — M3 performance inspector (minimal viable). 4 cards: JS heap used/total,
    JS metric counts, top 20 estimated re-render hot-spots, recent-error count. FPS
    / native frame timing deferred to a follow-on.
  - **E-20** — M3 navigation inspector. Reads from the user-installed in-app bridge
    (`globalThis.__ICARUS_NAV_STATE__`). If missing, the panel shows a copy-paste
    snippet the user can drop into their app.
- **E-21** — M3 release workflow. `electron-builder.yml` packages a macOS `.dmg` +
  `.zip`; the `.github/workflows/release.yml` CI workflow builds on a tag push, signs
  + notarizes when the matching Apple Dev ID secrets are set, uploads the artifact to
  GitHub Releases. Resolves OQ-17, OQ-18, OQ-19.

### Internal

- All M3 inspectors share the same `onCdpSendChange` hook (one live CDP
  connection, four consumers now: network inspector, component tree, storage
  inspector, performance inspector, navigation inspector). Adding a new inspector
  is one `setCdpSend` call away.
- `core/src/protocol/cdp/eval.ts` — the `Runtime.evaluate` wrapper (typed errors,
  timeout, never throws). 6 tests, used by E-17 / E-18 / E-19 / E-20.
- `core/src/react-tree/walk.ts` — the pure React-fiber walker (used by E-17 and
  re-used by E-19's render-hotspot probe). 16 tests.
- `core/src/protocol/network/{aggregate,recorder,body}.ts` — the correlated
  network model (E-16). 24 tests total.

### Test counts

- Core unit tests: 318 → 384 (+66)
- Desktop unit tests: 88 → 112 (+24)
- E2E tests: 10 (unchanged)
- Core coverage: 87.65% → 89.39% (the new code is well-tested; coverage grew)

### Documentation

- New plan docs: `22` (E-15), `23` (E-16), `24` (E-17), `25` (E-18),
  `26` (E-19), `27` (E-20), `28` (E-21).
- New closeout: `reports/m3-slice-1-closeout.md` (covering E-15 + E-16).
- `progress-report.md` updated to include E-16.
- New operator guide: `docs/engineering/RELEASE.md`.
- OQ-17, OQ-18, OQ-19 resolved in `99-open-questions.md`.

### Open debt carried forward

See `docs/engineering/technical-debt.md` for the full list. The big remaining
items after the M3 additive work:

- **TD-01** — in-process module isolation (deferred until a native-binding
  module or a module-caused crash).
- **TD-02** — Electron footprint/memory (deferred until real user feedback).
- **TD-03** — Turborepo (premature; trigger: 12+ packages or 60s+ cold build).
- **TD-12** — Windows tree-kill parity (deferred until Windows is a committed
  target).
- **TD-13** — Android via adb (horizontal, parallel — not on the macOS-first
  critical path).

---

## [M2] — 2026-07-26 — AI Assistant Grounded in Context (thin slice)

The headline differentiator, shipped responsibly. An assistant that reads a
`DebugContextStore` snapshot and answers over it, with an explicit, visible
**data-boundary / redaction** step (`buildAiSendPayload`) and a pre-send
**consent gate** (review the exact redacted bytes → Send/Cancel).

- **E-12** — Data boundary. `redact()` (secrets/PII); bounded, token-capped,
  category-filtered `ContextBundle`; the single `buildAiSendPayload` choke point;
  the **canary** boundary test (a planted secret never crosses the boundary).
- **E-13** — Grounded assistant. `AIProvider` seam + `askAssistant` orchestrator;
  `@icarus/ai` Anthropic provider (BYOK); OS-encrypted `KeyStore` via Electron
  `safeStorage`; desktop wiring + per-window review/send IPC; the renderer
  Q&A panel; the **grounding acceptance test** (the answer is built from
  non-pasted captured data).
- OQ-6 (telemetry) and OQ-7 (AI provider choice) resolved.

---

## Earlier

- **M1** — 2026-07-25 — First Useful Loop: Run an RN App + Unified Logs.
  Detect a React Native project → start Metro → launch on a simulator →
  unified live logs (Metro + native + console), searchable/filterable.
  First real `DebugContextStore` slices. CDP transport + multiplexing
  proxy; module SDK + IPC streaming extracted from real features.
- **M0** — 2026-07-25 — CDP Spike (go/no-go gate) + Walking Skeleton +
  Process Core. Monorepo (~3 packages), TS strict, hardened Electron shell
  (ADR-0004), typed query+command IPC, one real command (`doctor.check`)
  end-to-end. `ProcessManager` (0-orphans across a 50-run force-quit
  soak) and the environment `doctor`.
