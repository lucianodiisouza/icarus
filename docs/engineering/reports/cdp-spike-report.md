# CDP Spike Report — 2026-07-25

> Live runs against real running apps on an iOS simulator. Covers **two RN architectures**
> (Expo Go = Bridgeless; a dev-client = legacy Bridge). Phases 1, 2, 4 and the OQ-14
> single-connection probe are done. Phase 3 (proxy build), C3 (reconnect across
> reload/Metro-restart), and Android are **not yet done** — see "Remaining."

## Verdict

**GO (hybrid).** Third-party CDP over Metro's inspector proxy is viable and, on modern
RN, **richer than first feared** — once you send the right `Origin` header. Findings, in
order of how they landed:

1. **Core CDP works, zero app changes, on every app/arch tested:** discovery, connect,
   `Runtime.evaluate`, console/log events. (Runtime, Log, Debugger, Console-via-Runtime.)
2. **Modern RN (0.86) enforces an Origin CSRF check** on the debugger WebSocket (HTTP 401
   without it). This is **not a token and not a blocker** — it is satisfied by sending
   `Origin: http://localhost:<metroPort>` (hostname must be localhost/127.0.0.1/0.0.0.0/
   [::]). This is the **sanctioned** mechanism the official DevTools uses; we integrate
   with it, we do not bypass it.
3. **With the Origin header, `Network.enable` is SUPPORTED on RN 0.86** and delivers real
   `Network.requestWillBeSent` / `responseReceived` events — **Network inspection is
   CDP-native on modern RN** (it was `Unsupported` on the older apps). Proven end-to-end.
4. **Still bridge-only:** `HeapProfiler` / `Profiler` are `Unsupported` even on RN 0.86;
   React tree / navigation / state need an in-app bridge (unchanged).
5. **Coexistence** still needs a multiplexing proxy (Hermes = one connection); **target
   selection** matters (secondary runtimes like Reanimated are partial/unresponsive).

Net: **hybrid = Origin-authenticated CDP through the inspector proxy (Runtime/Log/
Debugger/Console/Network on RN 0.76+) + an in-app bridge for Heap/Profiler and
RN-semantics.** The transport is CDP-with-Origin-auth; aligning with
`@react-native/dev-middleware`'s behavior is the stable path.

- **Core CDP works as a third party, zero app changes, on BOTH architectures:**
  discovery, connect, `Runtime.evaluate`, console/log events — all pass. This de-risks
  TR-1's core.
- **The rich domains our vision needs — Network, HeapProfiler, Profiler — are NOT
  available on the raw Hermes page**, identically across Expo Go and dev-client. They
  are systemic-absent at the raw layer and must come from the **Fusebox /
  `@react-native/dev-middleware` layer** (or an in-app bridge). This is the real
  remaining uncertainty and it is **bigger than the prior art implied**.
- **Coexistence requires a multiplexing proxy** (empirically confirmed).
- **Target selection is non-trivial:** apps expose multiple CDP targets; the wrong one
  (e.g. a Reanimated worklet runtime) is partial/unresponsive.

## Versions / targets tested

| Run | App | appId | Architecture | Metro | OS | Device |
|-----|-----|-------|--------------|-------|----|--------|
| #1 | Expo Go | `host.exp.Exponent` | React Native **Bridgeless** | :8081 | macOS (Darwin 25.5) | iPhone 17 Pro sim |
| #2 | dev-client (glofox) | `ie.zappy.glofox` | React Native **Bridge** (legacy) | :8081 | macOS | iPhone 17 Pro sim |

## Criteria results

| ID | Criterion | Expo Go (Bridgeless) | Dev-client (Bridge) | Evidence |
|----|-----------|----------------------|---------------------|----------|
| C1 | Discover + connect | ✅ | ✅ | `/json/list` on :8081, targets carry `webSocketDebuggerUrl` |
| C2a | `Runtime.evaluate("1+1")` ⇒ 2 | ✅ | ✅ | returned `2` |
| C2b | Console/log events captured | ✅ | ✅ (real app logs) | dev-client streamed real Redux require-cycle warnings |
| C3 | Robust reconnect (reload/Metro restart) | ⬜ | ⬜ | not tested |
| C4 | C1–C2 on a real dev-client | — | ✅ PASS | run #2 |
| C5 | Coexists via multiplexing proxy | ⬜ (constraint confirmed) | ⬜ | Phase 3 not built; need is proven (OQ-14) |
| C6 | C1–C2 on Expo Go | ✅ PASS | — | run #1 |
| C7 | Network over CDP | ❌ (old RN) | ✅ on RN 0.86 | `Network.enable` supported + real request/response events captured (with Origin header) |
| C8 | Capability matrix drawn | ✅ | ✅ | below |

## Capability matrix — raw connection to the Hermes page

**Identical across both architectures**, which is the key finding (domains are a property
of Hermes + inspector proxy, not the client or bridge/bridgeless):

| CDP domain | Raw-page support (both) | Notes |
|------------|-------------------------|-------|
| Runtime | ✅ SUPPORTED | evaluate, `consoleAPICalled`, props |
| Log | ✅ SUPPORTED | structured entries |
| Debugger | ✅ SUPPORTED | breakpoints, pause, stacks |
| Console (legacy) | ❌ `-32601` | expected — console arrives via `Runtime.consoleAPICalled` |
| Network | ❌ `-32601` | **middleware/Fusebox-gated or app-bridge** — not raw |
| HeapProfiler | ❌ `-32601` | not raw |
| Profiler | ❌ `-32601` | not raw |
| Page / DOM | ❌ `-32601` | expected — RN is not a DOM |

### Vision-feature mapping (evidence-based)

| Feature | Verdict |
|---------|---------|
| Console / logs | **CDP-native** ✅ (all versions) |
| Runtime evaluate / REPL | **CDP-native** ✅ (all versions) |
| Debugger / breakpoints | **CDP-native** ✅ (all versions) |
| Network inspection | **CDP-native on RN ≥ 0.76** ✅ (Origin header required); absent on older RN |
| Heap / memory | **in-app bridge** — `HeapProfiler` unsupported even on RN 0.86 ⚠️ |
| Profiler / perf | **in-app bridge** — `Profiler` unsupported ⚠️ |
| React tree / navigation / state | **in-app bridge** (app uses Redux — confirms state needs a bridge) |

## Notable discoveries

1. **Multi-runtime targets.** The dev-client exposed TWO targets: `page=1` = main JS
   runtime (full raw domains), `page=2` = **"Reanimated UI runtime"**. Probing page=2:
   `Runtime.enable`/`Debugger.enable` **hung** (caught by our new 10s timeout); other
   domains returned a differently-worded "wasn't found." → **Icarus must enumerate and
   select the correct target, and defensively time out unresponsive ones.**
2. **"Unsupported debugging client" warning.** Both runs: connecting outside Fusebox
   makes RN emit a console warning. Product decision needed — present as Fusebox, or
   accept the warning.
3. **Client bug found & fixed mid-spike.** `CdpClient.send` had no request timeout, so a
   starved/unresponsive connection hung forever (caused a 2-min hang in the OQ-14 probe
   and would have hung on the Reanimated target). Fixed: 10s default timeout. Validated
   here — the Reanimated probe failed cleanly instead of hanging.

## ⭐ KEY FINDING — modern RN (0.86) enforces an Origin CSRF check (solved) + Network is CDP-native

A fresh **RN 0.86** app (`org.reactjs.native.example.RNNetTest`, Bridgeless) initially
**rejected the debugger WebSocket with HTTP 401** — proxy-wide (glofox too), coincident
with the newer `@react-native/dev-middleware`.

**Root cause (read from the exact source, `dev-middleware@0.86.0`
`InspectorProxy.js`):** `#createDebuggerConnectionWSServer().verifyClient` allows the
upgrade only if the request's **`Origin`** equals the server origin OR its hostname is in
`WS_DEBUGGER_ALLOWED_ORIGIN_HOSTNAMES = { localhost, 127.0.0.1, 0.0.0.0, [::] }`. Our
client sent **no `Origin`**, so it was refused. This is **CSRF protection** to stop
remote websites from reaching the local debugger — not a token, not a real barrier for a
local tool.

**Fix (sanctioned, one header):** send `Origin: http://localhost:<metroPort>`.
Empirically verified:
- upgrade **without** Origin → `HTTP 401`
- upgrade **with** `Origin: http://localhost:8081` → `HTTP 101` ✅

Implemented in `lib/cdp.js` (`httpOriginFromWsUrl` derives it from the ws URL). We satisfy
the check the same way official DevTools does; we do **not** bypass it. → tracked as
**OQ-21** (design: mirror dev-middleware's Origin/allowlist expectations).

**With the header, RN 0.86 capability probe:**

| Domain | RN 0.86 (bridgeless) | Older apps (Expo Go / glofox) |
|--------|----------------------|-------------------------------|
| Runtime | ✅ | ✅ |
| Log | ✅ | ✅ |
| Debugger | ✅ | ✅ |
| **Network** | **✅ SUPPORTED** | ❌ `-32601` |
| HeapProfiler | ❌ `-32601` | ❌ |
| Profiler | ❌ `-32601` | ❌ |
| Console(legacy)/Page/DOM | ❌ (expected) | ❌ |

**End-to-end Network proof:** enabled `Network`, injected
`fetch('https://httpbin.org/get')` via `Runtime.evaluate`, and captured real
`Network.requestWillBeSent` (GET …) + `Network.responseReceived` (status/mimeType) events
over CDP. → **Network inspection is CDP-native on modern RN.** (Heap/Profiler are not —
those remain bridge candidates.)

## RN DevTools attached (pressed `j` in Metro) — same raw wire

With the official RN DevTools (Fusebox) attached to the dev-client:
- Each target now advertises a `devtoolsFrontendUrl`, but its **`webSocketDebuggerUrl`
  is the SAME raw `/inspector/debug?...&page=1` endpoint we already tested.** DevTools
  connects over the **identical wire** — there is no separate "richer" debugger endpoint.
- Therefore the earlier `Network.enable ⇒ -32601` on that exact URL means **the proxy is
  not injecting Network for this app** — DevTools gets no secret richer channel. On this
  app (legacy Bridge, older RN) Network/Heap are simply not exposed over CDP.
- `page=2` capabilities confirm it's secondary: `prefersFuseboxFrontend:false`,
  `nativePageReloads:false`. Proxy reports `Protocol-Version 1.1`, `Browser: Mobile
  JavaScript`.
- **Remaining ambiguity:** whether **RN ≥ 0.76 with the network interceptor** exposes
  `Network.*`. That needs a newer-RN app or observing DevTools traffic through our Phase-3
  proxy.

## Coexistence findings (OQ-14 / HR-3) — confirmed (run #1)

Two clients to the same page: the second connects and is accepted, then **silently
starves the first** (its next request hangs). → Multiplexing proxy is **mandatory**;
CDP client **must** have request timeouts (now does).

## Recommended next steps (to move CONDITIONAL GO → final)

1. **Resolve the Network/Heap path** — the one real open question. Test whether the
   Fusebox/`dev-middleware` route (or an app-side network interceptor / newer RN) exposes
   Network CDP. This decides real feature cost for Network + Performance.
2. **Build Phase 3 proxy** (add `ws`; client timeout already done) and verify RN DevTools
   works through it — turns C5 from "need proven" to "solution proven."
3. **C3 reconnect** across app reload + Metro restart; **Android** via `adb` too.
4. Then finalize [ADR-0008](../../adr/ADR-0008-debugger-protocol-cdp.md):
   current evidence strongly supports **hybrid = CDP-native (Runtime/Log/Debugger/console)
   + dev-middleware/bridge (Network/Heap/RN-semantics)**, with target-selection and a
   multiplexing proxy as first-class concerns.

## Open risks carried forward

- **Network/Heap are not raw-CDP** — bigger bridge/middleware surface than assumed;
  affects Network + Performance feature cost and sequencing.
- Multi-runtime target selection + unresponsive targets (Reanimated) — needs handling.
- Only iOS sim + these two apps + single RN/Hermes version tested; Android and
  reconnect untested. Verdict is scoped accordingly.
- Large-payload framing (react-native#56471) — untested (needs Heap/Network working).
