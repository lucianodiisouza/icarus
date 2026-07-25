# 15 — CI/CD Proposal

CI/CD protects the two things the whole project depends on: a **releasable `main`** and a
**fast inner loop** (G-8, target < 10 min pipeline). This is a proposal for M0; it grows
with the project. Concrete provider is assumed to be **GitHub Actions** (OQ-16 if the
repo host differs).

## Principles

1. **Every PR must be provably green before merge.** No exceptions, no "fix it after."
2. **Fast feedback.** Cache aggressively; run the cheap, high-signal checks first so
   failures surface early.
3. **The pipeline enforces the architecture**, not just correctness — the boundary lint
   rule and security assertions are CI gates, not honor-system conventions (ADR-0004,
   Doc 11/12).
4. **Reproducible builds.** Pinned Node/pnpm versions; lockfile respected
   (`--frozen-lockfile`).

## Pipeline stages (PR / CI)

```
1. setup        checkout · setup node (pinned) · setup pnpm · restore pnpm store cache
2. install      pnpm install --frozen-lockfile
3. verify       (run in parallel where possible)
                ├─ typecheck   tsc --noEmit (all packages)
                ├─ lint        eslint (incl. no-electron-in-core boundary rule)
                ├─ format      prettier --check
                └─ unit+integration  vitest run  (core coverage gate ≥ 80%)
4. build        build all packages + apps/desktop (electron-vite)
5. package      electron-builder --dir (unpacked) to prove packaging works
6. e2e-smoke    Playwright-for-Electron smoke  (on PRs touching shell/ipc, and on main)
```

- Stages 3's checks run **concurrently** to hit the < 10 min budget.
- Turborepo (deferred, ADR-0001) is the escape hatch if wall-clock grows; the trigger is
  documented there.

## Caching strategy

- pnpm content-addressable store cached by lockfile hash.
- TS build info / Vite cache where safe.
- (Later) Turborepo remote cache if adopted.

## Platform matrix (honest scope)

- **Primary:** macOS runner (our primary target — NG-7; needed for any iOS tooling).
- **Pure-logic packages** (`core`, `ipc`, `module-sdk`) also run on Linux — they're
  shell-agnostic (ADR-0002) so this is cheap portability insurance.
- **Windows/Linux full app CI** is added when those become committed targets. We don't
  pretend to test a matrix we don't yet support.

## Security in CI

- Assert Electron hardening flags (T-02.5).
- Dependency audit (`pnpm audit` / a scanning action) — fail on high-severity; triage
  process for the rest.
- Secret scanning enabled on the repo. No secrets in the tree; signing/notarization creds
  live in CI secrets only (see [Release Strategy](16-release-strategy.md)).

## CD (delivery) — deliberately minimal until there's something to ship

- **M0–M1:** no public releases. CI produces an **unpacked build artifact** per run so we
  always know packaging works, but nothing is published.
- **From the first shippable milestone (M2+):** a **tag-triggered release workflow**
  builds signed/notarized artifacts and publishes to a channel (see Release Strategy).
- Auto-update wiring (electron-updater) is set up but pointed at a **pre-release/internal
  channel** first, so the update mechanism itself is battle-tested before GA.

## Branch protection (on `main`)

- Required status checks: typecheck, lint, format, unit+integration, build, package.
- Required review (≥ 1 maintainer; ≥ 1 with a security note for IPC/process PRs).
- Linear history preferred (rebase-merge); no force-push to `main`.

## Open questions

- OQ-16: repo host / CI provider (assumed GitHub Actions).
- OQ-17: signing identities & notarization (Apple Developer account; Windows code-signing
  cert) — needed before public macOS/Windows distribution; must be resolved before M2's
  release workflow ships.
