# CDP Feasibility Spike (E-Spike-CDP)

> **⚠️ Disposable spike code.** This directory exists only to answer the go/no-go
> question in [`docs/engineering/19-cdp-spike-plan.md`](../../docs/engineering/19-cdp-spike-plan.md).
> It is **not** production code, has no tests, and will be deleted once the verdict is
> recorded. The deliverable is the **report**, not this code. Do not build features here
> or import from it.

## What it does

Confirms — on our target versions — that a third-party tool can drive the Chrome
DevTools Protocol (CDP) through Metro's inspector proxy, for **bare RN and Expo**. Maps
directly to the phases in the spike plan:

| Script | Phase | Question |
|--------|-------|----------|
| `npm run discover` | 1 — Discovery | Can we find Metro + enumerate CDP targets? |
| `npm run connect`  | 2 — Connect & read | Can we get a `Runtime.evaluate` result + capture a `console.log`? |
| `npm run proxy`    | 3 — Coexistence | Does a multiplexing proxy let us + the user's DevTools share the one Hermes connection? |
| `npm run capabilities` | 4 — Map the ceiling | Which CDP domains respond? Where's the CDP-vs-bridge line? |

## Requirements

- **Node ≥ 21** (uses built-in global `WebSocket` and `fetch`).
  Verified on Node 22.19.
- **Phases 1, 2, 4 are zero-dependency.** **Phase 3 (the proxy) needs `ws`** — Node has
  no built-in WebSocket *server* — so run `npm install ws` inside `spike/cdp` before
  `npm run proxy`. (We use a real library rather than hand-roll RFC 6455 framing for
  potentially multi-MB CDP payloads — the exact rough edge flagged in react-native#56471.)
- A React Native / Expo app running with Metro + Hermes. See
  [`fixtures/README.md`](fixtures/README.md) to set up the bare-RN / Expo dev-client /
  Expo Go fixtures.

## Usage

```bash
cd spike/cdp

# Phase 1 — scan common Metro ports and list CDP targets
npm run discover

# Phase 2 — connect to the first target (or pass a ws URL) and read one real datum
npm run connect
npm run connect -- "ws://localhost:8081/inspector/debug?device=...&page=..."

# Phase 4 — probe which CDP domains are supported
npm run capabilities

# Phase 3 — start a minimal multiplexing proxy in front of a target
npm run proxy -- "<upstream-ws-url>"
```

All scripts print findings to stdout. Capture the output into
[`report/cdp-spike-report.md`](report/cdp-spike-report.md) as evidence.

## Known facts going in (from research — verify, don't trust)

- Target list at `GET /json` or `/json/list` on the Metro port; entries carry
  `webSocketDebuggerUrl`. Ports to scan: `8081`, `8082`, `19000–19002`.
- **Hermes allows only ONE concurrent CDP debugger connection** → Phase 3 (the proxy) is
  the real engineering, not the connection itself.
- Console / Network / Runtime / HeapProfiler / Debugger are expected CDP-native (no app
  changes); React tree / navigation / state likely need an in-app bridge.

See the plan's [Sources](../../docs/engineering/19-cdp-spike-plan.md#prior-art--sources-researched-2026-07-25).
