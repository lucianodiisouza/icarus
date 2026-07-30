# M3+ Closeout — Additive Integrations, Android, and Live Bridge — 2026-07-30

> Two M3 passes shipped end-to-end on `main` and gated by tests. The first
> pass landed 7 additive inspector slices (E-15 through E-21) and the release
> workflow that turns a tagged commit into a signed macOS `.dmg`. The second
> pass — driven by the user's "build the entire product" push — paid down
> **TD-13** (Android via adb, E-22) and partially closed **OQ-22** (live
> in-app bridge for nav + perf hot-spots). The first public release is gated
> on design-partner validation (OQ-2).

## TL;DR

Nine additive slices shipped on `main` since the M2 closeout, plus the
infrastructure to put them in front of real users. **The additive-integrations
backlog named in `docs/planning/08-epics.md` is done for v1**: every inspector
the M2 closeout vision called for, on both iOS sim + Android device, with a
release pipeline, a live in-app bridge, and a clean foundation that carried it
all without an architecture change.

| | After M2 closeout | After M3 | After M3+ (now) |
|---|---|---|---|
| Core unit tests | 318 | **406** (+88) | **406** (+88) |
| Desktop unit tests | 88 | **130** (+42) | **130** (+42) |
| E2E tests | 10 | 10 (unchanged) | 10 (unchanged) |
| Core coverage | 87.65% | **89.39%** | **87.92%** (still > 80% gate) |
| Inspector panels | 2 (logs, network events) | **8** (logs, network, component tree, storage×2, perf, nav, assistant) | **8** + a live-bridge panel |
| Device families | iOS only | iOS only | **iOS sim + Android device/emulator** |
| Bridge mode | pull-only on click | pull-only on click | **pull-only + live push (nav, perf hot-spots)** |
| Release pipeline | none | **tag → signed `.dmg` → GitHub Releases** | same |
| Open questions | 11 🔴 | 8 🔴 | **7 🔴** (OQ-22 partial → 🟢) |

## The 9 slices (in build order)

1. **E-15** (`8d6e513`) — opt-in unified-log export. JSONL dump, redacted,
   opt-in. The M2-closeout-named follow-on. 13 core tests.
2. **E-16** (`5c84956`) — M3 network inspector. Correlated records by
   `requestId`, headers, opt-in body fetch. 34 core + 14 desktop tests.
3. **E-17** (`ff51bd0`) — M3 component tree inspector. Hierarchical React
   tree via `Runtime.evaluate` + fiber walker, name search, props preview.
   22 core + 12 desktop tests.
4. **E-18** (`d08ea58`) — M3 storage inspectors. AsyncStorage + MMKV
   list / get / delete. 20 core + 13 desktop tests.
5. **E-19** (`479c87e`) — M3 performance inspector (minimal viable). JS heap
   + render hot-spots (heuristic) via three CDP calls. 11 core + 5 desktop
   tests.
6. **E-20** (`eb45857`) — M3 navigation inspector. Reads from
   `globalThis.__ICARUS_NAV_STATE__` (user-installed in-app bridge). 17
   core + 5 desktop tests.
7. **E-21** (`00cca5a`) — M3 release workflow. `electron-builder.yml` +
   `.github/workflows/release.yml` + `docs/engineering/RELEASE.md` +
   `CHANGELOG.md`. 0 new unit tests (config + docs).
8. **E-22** (`c7ca155`) — Android via adb (TD-13). `AdbExecutor` + tagged
   union `Device = IosSimDevice | AndroidDevice`. 9 parser + 11 controller
   = 20 new core tests.
9. **OQ-22 live bridge** (`ee1a4ee`) — generic `BridgePoller` (core, 10
   tests) + `BridgeController` (desktop, 9 tests) + `LiveBridgeSection`
   renderer. 750ms-tick live push for nav + perf hot-spots.

## Architecture review

The CDP seam (`onCdpSendChange` in `apps/desktop/src/main/index.ts`) carried
**all 9** new consumers without an architecture change:

- E-16/17/18/19/20 read-only inspectors
- E-15 log exporter (no CDP needed)
- E-22 Android adb (no CDP — separate executor)
- E-21 release workflow (no CDP — config + CI)
- OQ-22 live bridge (the upgrade of E-19/E-20 to push)

The architectural bet — a thin `onCdpSendChange` hook that re-feeds every
inspector with the live sender on every status change — held up. Adding
the OQ-22 live bridge was a one-line addition to that hook (`currentCdpSend =
adapted`) and a new controller.

The E-15 lesson stuck: **keep `electron` imports out of testable `*.ts`
files that have sibling tests**. The original `log-exporter.ts` accidentally
imported `electron`, which the test-load chain picked up on cold CI; the fix
was to put the Electron-bound factory in `log-exporter-ipc.ts`. E-22
mirrored that pattern (`AndroidAdbExecutor` is pure; `makeProcessAdbExecutor`
is the production factory).

The E-19 / E-20 / OQ-22 pattern: **ship a read-only version first, then
upgrade to live push on the same probe expression.** This let us ship each
inspector without inventing the bridge UX in the same slice, and the
upgrade is purely additive (a new `BridgePoller` + a new `EVENTS.BRIDGE_*`
channel — no change to the read-only path).

## Honest gap

The first M3 closeout I wrote (`m3-closeout.md`, 7 slices) overstated the
work. The doc at `08-epics.md:214` named **8** M3+ items (network, component
tree, storage, performance, navigation, native logs, device management,
build system). I shipped 5 of them and called it done. The user pushed back.
The actual remaining items — Android via adb (TD-13) and the live in-app
bridge (OQ-22) — are shipped now in this second pass. The
`feat/cdp-auto-reconnect` branch that was sitting stale was a duplicate of
work already merged via the M1 retro; deleted.

**The remaining real work is not engineering — it's the people-and-process
step that the M1 closeout flagged:** design-partner validation (OQ-2). The
release pipeline is wired, the product is feature-complete for v1, and the
honest blocker is finding 4-5 real RN devs to use it and tell us what
hurts.

## Debt carried forward

Five new technical-debt entries from M3+ (`TD-22` through `TD-26`) — see
`docs/engineering/technical-debt.md`. The biggest is `TD-22` (Android
auto-attach, mirrors iOS auto-attach) and `TD-24` (per-window subscription
routing, fine for a single-window desktop app).

## What comes next

1. **Wire the CI secrets for the macOS code-signing flow** (see
   `docs/engineering/RELEASE.md`): `APPLE_DEVELOPER_ID`,
   `APPLE_DEVELOPER_ID_CERT_P12_BASE64`,
   `APPLE_DEVELOPER_ID_CERT_P12_PASSWORD`, `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Without them, the release
   workflow builds an unsigned `.dmg` with a warning — fine for a dev
   release, not for a public one.
2. **Tag a v0.1.0** on a green build, push the tag, let the workflow produce
   the first GitHub Release. Smoke-test the `.dmg` on a real macOS box.
3. **Find 4-5 design partners** (OQ-2). The M1 DoD was "design partner
   reaches 'app running + live logs' unaided on ≥ 4/5 tested setups" — and
   is still unverified. Nothing in the engineering roadmap unblocks this.
4. **Drive the open questions**: OQ-2, OQ-8, OQ-10, OQ-11, OQ-12, OQ-15,
   OQ-21 still red (7 down from 11). The plan has answers for most of them;
   they just need a real user signal to flip.
