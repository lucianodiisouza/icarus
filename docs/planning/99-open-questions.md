# 99 — Open Questions (living register)

Every unresolved decision lives here rather than being silently guessed. Each has a
status, an owner discipline, and where it must be resolved. **We do not manufacture
certainty**; an item here is honest ignorance, not indecision.

Status: 🔴 open · 🟡 investigating · 🟢 resolved (with link to the ADR/decision).

| ID | Question | Status | Must resolve by | Notes |
|----|----------|--------|-----------------|-------|
| OQ-1 | Primary OS target & order | 🟢 | — | **Resolved 2026-07-25: macOS-first** (keep code cross-platform-clean; no Win/Linux parity guarantee early). A-1 confirmed. |
| OQ-2 | Is the fragmentation pain sharp enough to switch tools? | 🔴 | M1 (design-partner interviews) | PR-1. The whole product thesis. |
| OQ-3 | Who exactly is the target dev (Expo vs bare RN, team size)? | 🟢 (partial) | — | **Resolved 2026-07-25: target BOTH bare RN + Expo** from the spike onward. Team-size targeting still open (folds into OQ-2 interviews). |
| OQ-4 | **Can a 3rd-party tool reliably drive CDP via Metro's inspector proxy?** | 🟢 | — | **Resolved: YES** (M0 spike, live). Origin-authed CDP; Runtime/Log/Debugger/Console + Network (RN≥0.76). [ADR-0008](../adr/ADR-0008-debugger-protocol-cdp.md) Accepted. |
| OQ-5 | Does connecting conflict with the user's own RN DevTools? (multi-client) | 🟢 | — | **Resolved: yes — Hermes allows 1 connection; a 2nd starves the 1st.** Fix: multiplexing proxy. Same as OQ-14. |
| OQ-6 | Telemetry: collect anything? what? how consented? | 🟢 | — | **Resolved 2026-07-25: opt-in, anonymous, never debug data** — OFF by default; only allow-listed engineering-health events on consent; no source/logs/network/paths/PII ever. [ADR-0010](../adr/ADR-0010-telemetry-opt-in.md) Accepted. Unblocks M2 + automated Success Metrics. |
| OQ-7 | AI: local model vs API vs bring-your-own-key? | 🟢 | — | **Resolved 2026-07-25: swappable `AIProvider`, BYOK-Claude first, local later** — requests go directly from the user's machine to the provider (default Anthropic/Claude via `@anthropic-ai/sdk`); Icarus runs no backend and never holds the key or sees context. AI stays optional. [ADR-0011](../adr/ADR-0011-ai-provider-byok-swappable.md) Accepted. Unblocks M2 (E-12/E-13). |
| OQ-8 | Do any feature modules need process isolation (vs in-process)? | 🔴 | When first risky module lands | ADR-0007. Trigger: native binding or first module-caused crash. |
| OQ-9 | Is debug context ever persisted to disk (session replay)? | 🟢 | — | **Resolved 2026-07-26: yes — a bounded, local-only tail, cleared on clean exit.** The unified log persists only a recent-history window under `userData`, restored on launch and removed on a normal close — so a **crash** is recoverable but a clean close leaves no durable debug-log footprint. Local-only; never transmitted (E-12 still gates AI). Full history/export is a deliberate non-default. [ADR-0012](../adr/ADR-0012-unified-log-persistence.md) Accepted; pays down TD-19. |
| OQ-10 | Package granularity for feature modules (one pkg each vs grouped) | 🔴 | First real module | ADR-0001. |
| OQ-11 | Min acceptable footprint/memory before Electron is a blocker | 🔴 | Needs real user feedback | ADR-0002 / TR-7. |
| OQ-12 | Renderer styling system & component/virtualization lib | 🔴 | First UI Epic | ADR-0005. |
| OQ-13 | Delta representation for store→UI (JSON patch vs domain diffs) | 🟢 | — | **Resolved 2026-07-25: domain deltas** (E-03s). The first streaming feature (unified log) is append-only, so the delta is one shape — `{ appended: entries[] }` — plus a bounded-ring snapshot. JSON-patch/structural-diff machinery buys nothing here; revisit only if a non-append-only slice needs it. [ADR-0006](../adr/ADR-0006-ipc-and-state.md). |
| OQ-14 | Icarus + user's own RN DevTools coexistence on one app | 🟢 | — | **Resolved: multiplexing proxy required** (Hermes = 1 connection, confirmed empirically). Build in M1. |
| OQ-15 | How much native-tooling (adb/simctl) is CI-testable vs manual | 🔴 | As those Epics land | Doc 14. |
| OQ-16 | Repo host / CI provider | 🟢 | — | **Resolved 2026-07-25: GitHub + GitHub Actions.** Doc 15. |
| OQ-17 | Signing identities & notarization (Apple Dev ID, Win cert) | 🟢 | — | **Resolved 2026-07-30 (E-21):** the macOS code-signing + notarization workflow is wired in `.github/workflows/release.yml` and `apps/desktop/electron-builder.yml`. The Apple Developer ID + `.p12` + `notarytool` env vars are CI secrets only — never in the repo. Local dev: builds unsigned + warning (expected on a dev box). Windows: deferred until a committed target. See [`docs/engineering/RELEASE.md`](../engineering/RELEASE.md). |
| OQ-18 | Packaging tool: electron-builder vs electron-forge | 🟢 | — | **Resolved 2026-07-30 (E-21):** `electron-builder` — mature, well-documented, supports signing + notarization natively, has a working `autoUpdater` story. The decision is in `apps/desktop/electron-builder.yml` and is reversible. |
| OQ-19 | Distribution surface (direct/Homebrew/store) | 🟢 | — | **Resolved 2026-07-30 (E-21):** GitHub Releases — direct download from the release page. `autoUpdater` is wired but not auto-publishing (doc 16 — "surface, not force"). The full release doc is at [`docs/engineering/RELEASE.md`](../engineering/RELEASE.md). |
| OQ-20 | How do Expo (dev-client/Go) vs bare RN differ in Metro/inspector launch & CDP behavior? | 🟢 | — | **Resolved: raw CDP domain set is identical across Expo Go/dev-client/bare** (property of Hermes+proxy). Differences are RN *version* (Network needs ≥0.76), not client. |
| OQ-21 | How to robustly satisfy & track `dev-middleware`'s Origin/allowlist across RN versions; where the multiplexing proxy lives | 🔴 | M1 (transport impl) | From the spike. Origin CSRF check today = `{localhost,127.0.0.1,0.0.0.0,[::]}`; must track upstream drift. [ADR-0008](../adr/ADR-0008-debugger-protocol-cdp.md). |
| OQ-22 | In-app bridge design (Heap/Profiler + React tree/navigation/state): scope, install UX, versioning | 🔴 | When those features scheduled | The Option-B half of the hybrid. Own ADR when scheduled. |

## How this register is used

- New uncertainty discovered mid-Epic is added **immediately**, not deferred.
- Resolving an item means writing/linking an ADR or a documented decision and flipping
  the status to 🟢 with a link.
- OQ-4 is special: it **gates the roadmap**. Until it's resolved, M2+ plans are
  provisional.
