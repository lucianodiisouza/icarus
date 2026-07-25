# CDP Spike Report — 2026-07-25

> Live runs against real running apps on an iOS simulator. Covers **two RN architectures**
> (Expo Go = Bridgeless; a dev-client = legacy Bridge). Phases 1, 2, 4 and the OQ-14
> single-connection probe are done. Phase 3 (proxy build), C3 (reconnect across
> reload/Metro-restart), and Android are **not yet done** — see "Remaining."

## Verdict

**CONDITIONAL GO — hybrid confirmed, with a larger middleware/bridge surface than first
assumed.**

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
| C7 | Network bodies over CDP (raw page) | ❌ | ❌ | `Network.enable` ⇒ `-32601` on both |
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
| Console / logs | **CDP-native** ✅ |
| Runtime evaluate / REPL | **CDP-native** ✅ |
| Debugger / breakpoints | **CDP-native** ✅ |
| Network inspection | **NOT raw-CDP** — via dev-middleware/Fusebox or in-app bridge ⚠️ |
| Heap / memory / perf | **NOT raw-CDP** — same ⚠️ |
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
4. Then finalize [ADR-0008](../../../docs/adr/ADR-0008-debugger-protocol-cdp.md):
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
