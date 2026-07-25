# 16 — Release Strategy

How Icarus is versioned, packaged, distributed, and updated. Because we ship a
**desktop app that takes privileged local actions**, releasing is a trust event, not just
a build step — signing, notarization, and a safe update path are part of the strategy,
not afterthoughts.

> Phase-0 reality: we have nothing to release yet. M0–M1 produce **internal build
> artifacts only** (proving packaging works). The first real release is at the first
> shippable milestone (**M2**). This document is the plan for when that time comes.

## Versioning

- **Semantic Versioning** (`MAJOR.MINOR.PATCH`) for the app.
- **Pre-1.0 (`0.x`) during M0–M3:** we are explicitly pre-stable. Breaking changes are
  expected; `0.x` communicates "foundation, moving fast." This is honest signaling, not a
  marketing choice.
- `1.0.0` is reserved for the first release we'd tell a stranger to depend on daily —
  gated on real design-partner validation (Success Metrics), not a date.
- ADRs and this docs tree are the changelog's backbone; a human-readable `CHANGELOG.md`
  (Keep a Changelog format) is generated/curated per release.

## Release channels

| Channel | Audience | Cadence | Stability |
|---------|----------|---------|-----------|
| `internal` | maintainers (M0+) | every green `main` (artifact only) | may break |
| `beta` | design partners (M2+) | per milestone / meaningful slice | rough edges expected |
| `stable` | public (post-validation) | when quality bar met | supported |

We validate the **auto-update mechanism on `internal`/`beta` first**, so the update path
itself is proven before any `stable` user relies on it.

## Build & packaging

- **electron-builder** (or electron-forge — decided in the release Epic, OQ-18) produces
  platform installers.
- **macOS first** (NG-7): signed with an Apple Developer ID and **notarized** — required
  or Gatekeeper blocks the app. This is a hard prerequisite (OQ-17).
- **Windows/Linux:** packaged when they become committed targets; Windows needs code
  signing to avoid SmartScreen friction.
- Artifacts are reproducible from a tagged commit; the release workflow is
  **tag-triggered** (see [CI/CD](15-ci-cd.md)).

## Auto-update

- **electron-updater** against a release feed.
- Updates are **surfaced, not forced**: the user is informed and consents (aligns with
  G-7 trust posture). Never silently swap the binary of a tool that controls their
  machine.
- A rollback story: keep the previous version's feed entry so a bad release can be pinned
  back quickly.

## Release process (once we're shipping, M2+)

1. Cut a release branch / tag `vX.Y.Z` from a green `main`.
2. Tag triggers the release workflow: build → sign → notarize → package → publish to the
   target channel's feed.
3. Smoke the produced artifact (install + launch + core loop) before promoting.
4. Update `CHANGELOG.md`; note any superseded ADRs / resolved Open Questions.
5. Promote `beta → stable` only after the channel's stability bar and design-partner
   sign-off.

## Support & deprecation

- Pre-1.0: only the latest version is supported; we don't backport to `0.x` older builds.
- Post-1.0: a stated support window per minor version — defined when we get there, not
  pre-committed with fake certainty.

## Security & integrity

- Signing/notarization credentials live **only in CI secrets** (OQ-17); never in the
  repo.
- Every published artifact is signed; checksums published alongside.
- A responsible-disclosure path (`SECURITY.md`) is added before the first public
  `beta` — a tool with this much local privilege needs one.

## Open questions

- OQ-17: signing identities & notarization setup (Apple Developer ID; Windows cert).
- OQ-18: packaging tool (electron-builder vs electron-forge) — decided in the release
  Epic when M2 packaging is built.
- OQ-19: distribution surface (direct download, Homebrew cask, a website, app stores?) —
  decided based on where design partners actually are.
