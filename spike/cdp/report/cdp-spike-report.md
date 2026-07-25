# CDP Spike Report — 2026-07-25 (partial run #1)

> Live run against a **running Expo Go app** on an iOS simulator. Phases 1, 2, 4 and the
> OQ-14 single-connection probe were executed. Phase 3 (proxy), C3 (reconnect), and the
> bare-RN / Expo-dev-client fixtures are **not yet done** — see "Remaining."

## Versions tested

| Fixture | RN | Expo | Runtime | Metro port | OS | Device |
|---------|----|------|---------|-----------|----|--------|
| **Expo Go** (`host.exp.Exponent`) | Bridgeless (C++ connection) | Expo Go | Hermes | 8081 | macOS (Darwin 25.5) | iPhone 17 Pro sim |

> Note: this is the **P2 constrained worst case** (Expo Go), not our own fixture — so no
> `ICARUS_PROBE` marker was present. Bare RN and Expo dev-client remain to be tested and
> may expose a different (likely richer) surface.

## Verdict (provisional)

**CONDITIONAL GO.** Third-party CDP works even on the constrained Expo Go worst case:
discovery, connect, `Runtime.evaluate`, and console events all succeed with **zero app
changes**. **But** the rich domains our vision leans on — **Network, HeapProfiler,
Profiler — are NOT available** when connecting raw to the Hermes page; only **Runtime,
Log, Debugger** are. Those richer domains route through the **Fusebox frontend /
`@react-native/dev-middleware` proxy layer**, which we bypass by connecting directly.
This sharpens (and partly worsens) the hybrid picture: **more of the value than expected
sits behind the middleware/bridge, not raw Hermes CDP.**

## Criteria results

| ID | Criterion | Expo Go | Evidence |
|----|-----------|---------|----------|
| C1 | Discover + connect | ✅ PASS | `/json/list` on :8081 returned 2 targets with `webSocketDebuggerUrl` |
| C2a | `Runtime.evaluate("1+1")` ⇒ 2 | ✅ PASS | returned `2` |
| C2b | Console event captured | ✅ PASS (mechanism) | received a real `Runtime.consoleAPICalled` (the "unsupported debugging client" NOTE). Marker-match N/A — not our fixture |
| C3 | Robust reconnect (reload/Metro restart) | ⬜ not tested | |
| C4 | C1–C2 on Expo dev-client | ⬜ not tested | |
| C5 | Coexists via multiplexing proxy | ⬜ not tested (Phase 3) | but the constraint it solves is now confirmed — see OQ-14 |
| C6 | C1–C2 on Expo Go | ✅ PASS | this run |
| C7 | Network bodies over CDP | ❌ FAIL (raw page) | `Network.enable` ⇒ `Unsupported method (-32601)`. Likely available via dev-middleware, untested |
| C8 | Capability matrix drawn | ✅ done (below) | |

## Discovery findings (Phase 1)

- Endpoint `GET http://localhost:8081/json/list` works; returns CDP-style targets.
- Two targets (`page=1`, `page=2`), **identical** metadata: `description: "React Native
  Bridgeless [C++ connection]"`, `type: node`, `appId: host.exp.Exponent`.
- Targets carry useful `reactNative.capabilities`:
  `prefersFuseboxFrontend: true`, `nativePageReloads: true`,
  `nativeSourceCodeFetching: false`, plus a `logicalDeviceId`. **Actionable:** these
  capability flags are how Icarus can detect Fusebox-preferring targets and reload
  behavior.

## Connect/read findings (Phase 2)

- Raw WebSocket connect to the page URL works as a third party.
- `Runtime.enable` ⇒ ok; `Runtime.evaluate("1+1")` ⇒ `2`.
- On connect, Hermes/RN emits a console **warning**: *"You are using an unsupported
  debugging client. Use the Dev Menu … to open React Native DevTools."* → connecting
  outside Fusebox is tolerated but flagged. Worth a product decision (do we present as
  Fusebox, or accept the warning?).

## Capability matrix (Phase 4 — raw connection to the Hermes page, Expo Go)

| CDP domain | Raw-page support | Implication |
|------------|------------------|-------------|
| Runtime | ✅ SUPPORTED | evaluate, console events, properties |
| Log | ✅ SUPPORTED | structured log entries |
| Debugger | ✅ SUPPORTED | breakpoints, pause, stacks |
| Console (legacy) | ❌ `Unsupported` | expected — console comes via `Runtime.consoleAPICalled` |
| Network | ❌ `Unsupported` | **not raw** — routes via dev-middleware/Fusebox, or needs a bridge |
| HeapProfiler | ❌ `Unsupported` | not raw on Expo Go — revisit on bare RN / via middleware |
| Profiler | ❌ `Unsupported` | not raw on Expo Go |
| Page / DOM | ❌ `Unsupported` | expected — RN is not a DOM |

### Vision-feature mapping (first pass)

| Feature | Verdict (this run) |
|---------|--------------------|
| Console / logs | **CDP-native** ✅ |
| Runtime evaluate / REPL | **CDP-native** ✅ |
| Debugger / breakpoints | **CDP-native** ✅ |
| Network inspection | **NOT raw-CDP** — needs dev-middleware path or in-app bridge ⚠️ |
| Heap / memory | **NOT raw-CDP on Expo Go** — retest on bare RN / via middleware ⚠️ |
| React tree / navigation / state | expected **in-app bridge** (unchanged) |

## Coexistence findings (OQ-14 / HR-3) — **confirmed**

Empirical two-client probe against the same page:
- Client A connects, evaluates fine.
- Client B connects to the **same page simultaneously** → **accepted** (not rejected).
- Client A's **next request then hangs indefinitely** → the new debugger **silently
  starves the previous one** (matches the known "steals control" behavior).
- **Conclusions:**
  1. A **multiplexing proxy is mandatory** for coexistence (Phase 3 confirmed necessary).
  2. Our CDP client **must add a request timeout** — it currently hangs forever when
     starved (caused the 2-min probe timeout). Fix in `lib/cdp.js` before Phase 3.

## Recommended next step

1. **Re-run on bare RN and an Expo dev-client build** — determine whether Network/Heap
   appear there, or are truly middleware-only everywhere.
2. **Test the `@react-native/dev-middleware` path for Network** — the likely home of
   Network CDP. This decides whether Icarus embeds/proxies the middleware vs. ships an
   in-app network bridge.
3. **Build Phase 3 proxy** (add `ws`, add client request-timeout first) and verify RN
   DevTools works through it.
4. Only then set [ADR-0008](../../../docs/adr/ADR-0008-debugger-protocol-cdp.md) status.
   Current data already leans **hybrid**, with a bigger bridge/middleware surface than
   first assumed.

## Open risks carried forward

- **Network/Heap are middleware-gated, not raw-CDP** (this run) — materially affects the
  Network/Performance feature cost and the CDP-vs-bridge line.
- CDP client lacks request timeouts (found here) — must fix.
- Large-payload framing (react-native#56471) — untested (needs Heap working first).
- Only Expo Go + iOS sim tested; single RN/Hermes version. Verdict is version/target-
  scoped until bare RN + dev-client are covered.
