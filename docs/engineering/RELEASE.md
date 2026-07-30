# Release — Operator's Guide

> How to cut a release of Icarus. Read this end-to-end before doing it for the
> first time; the second time, this is the checklist.

## TL;DR

```bash
# 1. Make sure main is green.
gh run list --branch main --limit 3

# 2. Bump the version, update the changelog, commit, tag.
# 3. Push the tag → CI builds, signs, notarizes, uploads to GitHub Releases.
git push origin v0.1.0

# 4. Smoke the artifact locally before promoting.
# 5. Promote to beta / stable when the bar is met.
```

The workflow is **tag-triggered** (`.github/workflows/release.yml`). Push a `v*`
tag and CI does the rest.

## Why this exists

Icarus is a desktop app that takes privileged local actions. Releasing is a
**trust event**, not just a build step — signing, notarization, and a safe
update path are part of the strategy (see [`16-release-strategy.md`](../engineering/16-release-strategy.md)).
This doc covers the **first** release's mechanics; the long-term plan (channels,
auto-update, design-partner validation) lives in the strategy doc.

## Decisions baked into this slice (resolves OQ-17/18/19)

- **Packaging tool: `electron-builder`** — mature, well-documented, supports
  signing + notarization natively, has a working `autoUpdater` story.
- **Distribution surface: GitHub Releases** — direct download from the
  release page.
- **Auto-update: wired but not auto-publishing** — see the strategy doc.
  Triggers when the first real release ships (post-OQ-2 validation).
- **Channels:** `internal` (any tagged commit), `beta` / `stable` (gated on
  design-partner data). For v1 we ship to `internal` only.

## Prerequisites — set these on the repo before the first real release

Go to **Settings → Secrets and variables → Actions** on GitHub and add:

| Secret | What it is | Required for |
|---|---|---|
| `APPLE_DEVELOPER_ID` | The name of the "Developer ID Application" identity in the keychain (e.g. `"Developer ID Application: Acme Inc (TEAMID)"`). The CI macOS runner will look it up by this name. | Code signing |
| `APPLE_DEVELOPER_ID_CERT_P12_BASE64` | The `Developer ID Application` certificate exported as `.p12`, base64-encoded. The CI runner imports it. | Code signing |
| `APPLE_DEVELOPER_ID_CERT_P12_PASSWORD` | The password for the `.p12`. | Code signing |
| `APPLE_ID` | The Apple ID email you use for notarization. | Notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password for that Apple ID (https://appleid.apple.com → App-Specific Passwords). | Notarization |
| `APPLE_TEAM_ID` | Your Apple Developer Team ID (10-char alphanumeric). | Notarization |

**Without these secrets, the build still produces a `.dmg` and `.zip`** — but
they're **unsigned**, and Gatekeeper will warn on first launch ("Icarus can't
be opened because it is from an unidentified developer"). That's fine for
`internal` testing; it's NOT fine for `beta` or `stable`.

## Cutting a release — step by step

### 1. Make sure `main` is green

```bash
gh run list --branch main --limit 3
# The 3 most recent runs should all be "success".
```

If any are red, **don't** cut a release off this branch. Fix the regressions,
merge to `main`, wait for green.

### 2. Bump the version + update the CHANGELOG

The `apps/desktop/package.json` `version` field is the source of truth for the
artifact filename (`Icarus-<version>-<arch>.dmg`).

**For v1 (pre-stable):** bump the **patch** version on every release
(0.0.0 → 0.0.1 → 0.0.2). Breaking changes bump the **minor** (0.0.x → 0.1.0)
and require updating this doc. v1.0.0 is reserved.

```bash
# Edit apps/desktop/package.json
#   "version": "0.0.0"  →  "version": "0.0.1"
#
# Then commit + push:
git checkout -b release/v0.0.1
git add apps/desktop/package.json
git commit -m "chore: bump version to 0.0.1"
git push origin release/v0.0.1
# Open a PR, get a review, merge to main.
```

### 3. Update the CHANGELOG

The CHANGELOG entry is human-written. Don't auto-generate it from commits
— the renderer surfaces this text in the "About" panel and in the GitHub
Release page. Aim for:

- One line per user-visible change
- Group by Epic (Network Inspector, Component Tree, etc.)
- Note any **breaking changes** explicitly (none in 0.x — that's a 1.0 thing)
- Note any **migrations** the user has to do (none yet)
- Note any **resolved Open Questions** (link to the ADR/decision)

```bash
# Edit CHANGELOG.md (top section)
# Commit + push:
git add CHANGELOG.md
git commit -m "docs: changelog for v0.0.1"
git push origin main
```

### 4. Tag + push

```bash
git tag v0.0.1
git push origin v0.0.1
# The release.yml workflow triggers automatically.
```

### 5. Watch CI

```bash
gh run list --workflow=release.yml --limit 1
# Watch the run:
gh run watch
```

The workflow:
1. Sets up Node 22 + pnpm on a macOS runner.
2. Installs dependencies (with the real Electron binary).
3. Runs `pnpm --filter @icarus/desktop build` (the `electron-vite` build that
   produces `apps/desktop/out/`).
4. Runs `electron-builder` (with the secrets in scope). The output is a `.dmg`
   + `.zip` in `apps/desktop/dist/`. If the secrets are set, the `.dmg` is signed
   + notarized; if not, the `.dmg` is unsigned and the log shows a clear warning.
5. Uploads the artifacts to GitHub Releases (the `softprops/action-gh-release`
   step), using the tag as the release name.

### 6. Smoke the artifact locally

**This step is not skippable.** Download the `.dmg` from the release page and
verify it boots, the security baseline holds, the doctor runs end-to-end, and
the new feature works against a real RN app.

```bash
# Download the .dmg from the release page.
open ~/Downloads/Icarus-0.0.1-arm64.dmg
# Drag Icarus.app to /Applications.
open /Applications/Icarus.app

# Smoke checklist:
#  [ ] App boots, window shows
#  [ ] No Gatekeeper warning (if signed) — or warning if unsigned, expected
#  [ ] Doctor runs end-to-end (green report)
#  [ ] Auto-attach fires when Metro starts + sim boots
#  [ ] New feature works (per the CHANGELOG entry)
#  [ ] All 5 inspectors + assistant work end-to-end
```

If anything's red, **don't** promote. Fix, push a patch (0.0.2), and re-tag.

### 7. Promote

For v1: every release is `internal`. **Don't** publish to a wider audience
until the design-partner validation (Success Metrics, OQ-2) is done. The
release doc will be updated when `beta` + `stable` channels go live.

## Rolling back a bad release

If a release ships and a regression is found:

1. **Delete the GitHub Release** (Settings → Releases → Delete). The artifact
   is removed from the release page; the tag stays.
2. **Force-move the tag to the previous good commit**:
   ```bash
   git tag -d v0.0.1                          # delete the bad tag locally
   git push origin :refs/tags/v0.0.1          # delete the bad tag remotely
   git tag v0.0.1 <previous-good-commit>      # re-tag the previous good commit
   git push origin v0.0.1                      # re-trigger the workflow
   ```
3. **Update the CHANGELOG** with a `## v0.0.1 (YANKED)` note explaining why.

The previous version is recoverable by anyone who already installed — they
uninstall the broken version, download the re-tagged artifact, and reinstall.
This is why the release doc says "smoke the artifact locally before
promoting" — once a release goes out, the rollback path is "delete + re-tag,"
which is friction the user feels.

## What's in the artifact

| File | What |
|---|---|
| `Icarus-0.0.1-arm64.dmg` | macOS Apple Silicon installer (drag-to-Applications) |
| `Icarus-0.0.1-x64.dmg` | macOS Intel installer |
| `Icarus-0.0.1-arm64.zip` | macOS Apple Silicon unpacked app (for advanced users / CI) |
| `Icarus-0.0.1-x64.zip` | macOS Intel unpacked app |
| `*.dmg.blockmap` | Used by `autoUpdater` to do differential updates (when enabled) |
| `*.zip.blockmap` | Same, for the zip artifacts |

`autoUpdate` is wired but **not** auto-publishing. The `publish` section in
`electron-builder.yml` is commented out; enable it after the first design-
partner validation (OQ-2) gates a `beta` channel.

## Open questions this slice resolves

- **OQ-17** (signing identities & notarization): partially resolved. The
  workflow is wired; the actual Apple Developer ID is a CI secret.
- **OQ-18** (packaging tool: `electron-builder` vs `electron-forge`):
  **resolved** — `electron-builder`. The decision is in `electron-builder.yml`
  and is reversible.
- **OQ-19** (distribution surface: Homebrew / store / direct):
  **resolved** — GitHub Releases. Auto-update is wired but not
  auto-publishing until the first real release.
