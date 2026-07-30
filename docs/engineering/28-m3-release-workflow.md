# 28 — M3 Slice 7: Release Workflow (E-21)

- **Milestone:** [M3+ — Additive Integrations](../planning/07-milestones.md).
- **What it delivers:** The **release workflow** — the build → sign → notarize → package
  pipeline that takes a green `main` and produces a downloadable artifact. Without this,
  no external user can run Icarus; the M3+ work is invisible to anyone outside the repo.

> Sizes: **M 1–2 days**. The hard parts are decisions (packaging tool, signing
> approach, distribution surface) — not the wiring.

---

## Goal

`pnpm run release` (and a tag-triggered GitHub Actions workflow) takes a tagged
commit and produces a signed macOS `.dmg` (and unsigned `.zip` for non-Gatekeeper
contexts). The artifact lives in GitHub Releases; the rest is `npm install`
and ship.

## Decisions taken in this slice (resolves OQ-17/18/19)

- **Packaging tool: electron-builder.** Mature, well-documented, supports signing +
  notarization natively, has a working `autoUpdater` story. The decision lives in
  the `electron-builder.yml` config file — reversible.
- **Signing + notarization: macOS first.** Resolves OQ-17 partially. The full
  Apple Dev ID + notarytool flow is wired; the actual secrets are *not*
  committed (they're CI secrets only — doc 16's hard rule). For local dev, the
  config is the same; without secrets the build still produces an unsigned
  `.dmg` (warning, not failure).
- **Distribution surface: GitHub Releases.** Resolves OQ-19. Direct download
  from the release page. `autoUpdater` is wired but **not** auto-publishing
  (the release strategy is "surface, not force" — doc 16). A real first public
  release gates on design-partner validation (Success Metrics), not a date.
- **Windows / Linux:** packaging config is in place but disabled (the
  macOS-first build runs; the others are commented out). Trigger: those
  become committed targets.

## What ships in this slice

1. `apps/desktop/electron-builder.yml` — the packaging config.
2. `apps/desktop/build/icon.png` (placeholder; replace with the real icon
   before the first public release).
3. `apps/desktop/package.json` scripts: `release` (one-off local build),
   `release:dir` (unpacked output, for smoke-testing).
4. `.github/workflows/release.yml` — tag-triggered CI workflow: build on
   macOS runner, sign + notarize (if secrets are set), upload to GitHub
   Releases.
5. `docs/engineering/RELEASE.md` — a step-by-step for the first release,
   including what secrets to set in CI, how to test the artifact, and
   how to roll back.

## What does NOT ship in this slice

- **A real first release.** The slice ships the *workflow*; the first
  actual release is gated on design-partner validation (Success Metrics,
  OQ-2). v1.0.0 is reserved.
- **Code-signing for Windows.** Doc 16 — Windows becomes a committed target
  first. (The `electron-builder.yml` has a Windows section commented out so
  the config is ready when the trigger fires.)
- **An auto-update feed.** Wired but not publishing. Doc 16 — surface,
  not force.
- **A real app icon.** The placeholder is a TODO. The first real release
  ships with a real icon (this is a product decision, not an engineering one).

## Tasks

| # | Task | Size | Depends | Notes |
|---|------|------|---------|-------|
| T-21.1 | `apps/desktop/electron-builder.yml` — packaging config (mac .dmg + .zip; win/linux commented) | M | — | Honors NG-7 (macOS-first) |
| T-21.2 | `apps/desktop/build/icon.png` (placeholder) + an `npm run release` script that runs `electron-builder` | S | T-21.1 | Verify the build works locally with the unsigned path (dev has no Apple Dev ID) |
| T-21.3 | `.github/workflows/release.yml` — tag-triggered CI workflow: build on macos-latest, sign + notarize (when secrets are set), upload to GitHub Releases | M | T-21.1 | The CI workflow is the part that actually publishes artifacts |
| T-21.4 | `docs/engineering/RELEASE.md` — the operator's guide: how to cut a release, what secrets to set, how to roll back | S | T-21.1–3 | This is the "what you do on release day" doc |
| T-21.5 | Update OQ-17/18/19 in `docs/planning/99-open-questions.md` to resolved, with a link to the new config | S | T-21.1 | Closes the long-running open questions |

## Definition of Done — E-21

- `pnpm run release` produces a working macOS `.dmg` (unsigned on a dev box, signed
  in CI when the secrets are set).
- The CI workflow runs on a `v*` tag push and uploads a `.dmg` to GitHub Releases.
- A doc (`docs/engineering/RELEASE.md`) explains how to cut a release, what secrets
  to set in CI, and how to roll back.
- OQ-17/18/19 are resolved (the docs tree is the source of truth).
- The artifact boots the existing e2e smoke (we have a Playwright `_electron` test
  in `e2e/app-smoke.spec.ts`; it runs against `out/` — the packaged artifact will
  need its own variant, but for v1 we trust the existing test as a sanity check).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| No Apple Dev ID in CI → notarization fails → no artifact | The CI workflow's `notarize` step is **conditional** on the secret being set. Without it, the build produces an unsigned `.dmg` + a clear warning. The release doc explains what the operator should do. |
| `electron-builder` has a steep config surface | We commit only the minimum (mac .dmg + .zip); win/linux sections are commented out with a "trigger: TD-12" note. The doc explains the build matrix. |
| First release happens before design-partner validation (OQ-2) | This is intentional and called out: v1.0.0 is reserved. The workflow is `internal` for now; `beta` + `stable` channels come when OQ-2 has data. |
| A bad release ships | Doc 16's "rollback story": keep the previous version's feed entry, surface a "downgrade" path in the renderer (we'll wire it when the auto-update feed goes live in a follow-on). For v1, the rollback is "delete the GitHub Release tag, re-tag from the previous commit." |

## Why this slice — and what comes after

E-21 is the **last** M3+ slice in the build order. After this, the product has:
- M0 (foundation) — done
- M1 (run + logs) — done
- M2 (AI assistant) — done
- M3+ (additive features: export, network, component tree, storage, perf, nav) — done
- **Release workflow** — done (this slice)
- M3 horizontal: Android via adb (TD-13) — still deferred (not on the critical path for macOS-first)

After E-21: the next move is **design-partner validation** (OQ-2). That's a
people-and-process step, not an engineering one. The engineering team
continues paying down debt (TD-02 footprint, TD-01 in-process isolation, etc.)
behind the scenes.
