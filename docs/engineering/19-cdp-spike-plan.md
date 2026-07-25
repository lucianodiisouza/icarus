# 19 — CDP Feasibility Spike Plan (Track A · the go/no-go gate)

- **Epic:** E-Spike-CDP · **Milestone:** M0, Track A (runs first; gates Track B investment)
- **Owner risk:** TR-1 · **Resolves:** OQ-4, OQ-5, OQ-14, OQ-20 · **Decides:** [ADR-0008](../adr/ADR-0008-debugger-protocol-cdp.md)
- **Nature:** **Disposable spike.** The code is throwaway; the _learnings and the
  decision_ are the deliverable. We test what we discover, not the script (Doc 14).
- **Time-box:** target ≤ 5 working days. If we can't reach a confident verdict in the
  box, that _itself_ is a signal (leaning no-go / conditional) — we escalate, we don't
  keep drilling indefinitely.

> **Prior-art update (2026-07-25, from web research — see Sources at end).** Much of
> what this spike set out to _discover_ is already **confirmed by working prior art**,
> which meaningfully de-risks TR-1. The spike's job shifts from "is this possible at
> all?" toward "**confirm on our target versions, measure the constraints, and decide
> the hybrid split.**" Confirmed facts (to re-verify on our tested versions, not blindly
> trust):
>
> - **Endpoints:** Metro's Inspector Proxy (the official `@react-native/dev-middleware`)
>   exposes a CDP-style target list at `/json` / `/json/list` on the Metro port, each
>   entry carrying a `webSocketDebuggerUrl`. Default port **8081**; Expo also uses
>   **19000–19002**; second instances use **8082+**. Port-scanning that set is the known
>   discovery method.
> - **Connection works as a third party, no app changes** for: **Console**, **Network**
>   (incl. request/response inspection), **Runtime** (`evaluate`), **Memory/HeapProfiler**
>   (sampling), **Debugger** (stack traces/symbolication). This is C1–C2 and C7
>   essentially pre-answered "yes."
> - **The coexistence constraint is real and has a known workaround:** **Hermes allows
>   only ONE concurrent CDP debugger connection.** A naive connect _will_ fight the
>   user's own DevTools. The established solution (used by `metro-mcp`) is a **CDP
>   multiplexing proxy** that fans the single Hermes connection out to multiple clients.
>   This converts OQ-14 from "unknown" to "solvable, with a designed proxy."
> - **The hybrid boundary is now visible:** RN-specific richness — **React component
>   tree / render profiling, navigation events, Redux/state** — appears to need an
>   **in-app bridge** (e.g. a `__METRO_BRIDGE__`-style global / optional npm package),
>   NOT pure CDP. So the architecture answer is almost certainly **CDP for the runtime
>   domains + an optional in-app agent for RN-semantic data** — a hybrid of ADR-0008
>   Options A and B, not a choice between them.
> - **Platform floor (from prior art):** Expo SDK ≥ 49 and bare RN ≥ 0.70 are where this
>   works; note that as our supported floor to verify.
>
> The spike is therefore **smaller and more confirmatory** than originally scoped, but
> still required: we must reproduce it on our exact versions, measure the multiplexing
> proxy's behavior/latency, and pin down the CDP-vs-bridge capability line. Where this
> plan still says "hypothesis/expected," treat it as "confirm on our versions."

---

## Why this is the gate

Everything vision-defining — component tree, Hermes state, console, network,
performance, and the AI's context — assumes we can pull **structured runtime data** out
of a running RN app over CDP, through Metro's inspector proxy, **as a third-party tool.**
If that assumption is false or badly constrained, [ADR-0008](../adr/ADR-0008-debugger-protocol-cdp.md)
flips to Option B (ship an in-app agent), and M1's roadmap, scope, and several non-goals
change. We buy that answer for days, before building anything of size.

## The core question, decomposed

1. **Discover** — Can we find a running Metro's inspector and enumerate its debuggable
   (CDP) targets, for **bare RN** and **Expo**?
2. **Connect** — Can we open a CDP WebSocket to a target and complete a real exchange?
3. **Read structured data** — Can we get at least: a `Runtime.evaluate` result and a
   `console.log` surfaced as a `Runtime.consoleAPICalled` event?
4. **Survive reality** — Reconnect across app reload / Metro restart (HR-1); coexist
   with the user's own RN DevTools without breaking either (HR-3 / OQ-14).
5. **Map the ceiling** — Which CDP domains/methods actually respond on Hermes? This
   tells us _which future features are even possible_ over this transport.

---

## Sample apps (fixtures — build these first)

Kept minimal, Hermes-enabled, each with a screen that emits a known `console.log("ICARUS_PROBE " + counter)` on a timer and a button that throws, so we have deterministic signals to look for.

| Fixture | What | Why |
|---------|------|-----|
| `fixture-bare` | Latest-stable **bare React Native**, Hermes on, iOS sim + Android emulator | The baseline case |
| `fixture-expo-devclient` | **Expo dev-client** app, Hermes on | Majority of new RN apps; dev-client ≈ bare inspector story |
| `fixture-expo-go` | Same app run in **Expo Go** | Known to be more constrained; tests the worst case (OQ-20) |

Record exact RN / Expo / Hermes / Metro versions in the report — the verdict is only
valid for versions we actually tested, and we say so.

---

## Procedure (phased; stop-on-hard-fail)

### Phase 0 — Environment & fixtures (½ day)
Build the three fixtures; get each running on a simulator/emulator with Metro up. Note
the Metro port(s) and any Expo-specific launch differences.

### Phase 1 — Discovery (1 day)  · answers Q1
- **Hypothesis to verify:** Metro exposes a CDP-style target list at
  `GET http://<host>:<port>/json` (and/or `/json/list`), each entry carrying a
  `webSocketDebuggerUrl`; `GET /json/version` returns proxy metadata.
- Poll it for each fixture; capture the raw JSON. Confirm targets appear/disappear as
  the app connects/reloads.
- Probe **port discovery**: default 8081, plus how we'd detect a non-default port and
  multiple concurrent Metro instances.
- **Hard-fail check:** if no target list is reachable for _any_ fixture → strong no-go
  signal for Option A; jump to the verdict with that finding.

### Phase 2 — Connect & read (1 day)  · answers Q2, Q3
- Open the CDP WebSocket to a target's `webSocketDebuggerUrl` (raw `ws`, no framework).
- Send, in order: `Runtime.enable`, then `Runtime.evaluate({expression:"1+1"})` → expect
  `{result:{value:2}}`.
- Assert we receive `Runtime.consoleAPICalled` events carrying our `ICARUS_PROBE` logs.
- Trigger the throw button; look for the error surfacing (via `Runtime.consoleAPICalled`
  of type error, and/or `Runtime.exceptionThrown`).
- **This is the "it's real" moment** — one structured datum out of the app over CDP.

### Phase 3 — Survive reality (1 day)  · answers Q4 (HR-1, HR-3, OQ-14)
- **Reconnect / lifecycle:** reload the app (`r` in Metro / fast-refresh); restart
  Metro. Confirm we can re-discover the (new) target and re-establish CDP. Record how
  target ids/URLs change and what a robust reconnect loop must do.
- **Coexistence (now: validate the known workaround, not discover the problem):** we
  already know Hermes permits **one** CDP debugger connection and that a **multiplexing
  proxy** is the fix (see prior-art note). So this phase builds a **minimal multiplexing
  proxy**: our spike connects to Hermes, and re-exposes a CDP endpoint that _both_ our
  client and the user's RN DevTools connect to. Measure: does DevTools work through it?
  Latency/overhead? What breaks on reload? This decides OQ-14 and de-risks the single
  most important UX constraint. If we can't make the proxy work, coexistence degrades to
  a "take-over / hand-off" model — record which.

### Phase 4 — Map the ceiling & the hybrid line (½–1 day)  · answers Q5
- For a connected Hermes target, probe each domain and record supported/partial/absent:
  `Runtime`, `Debugger`, `Console`, `Log`, `Network`, `HeapProfiler`, `Profiler`,
  `Page`/`DOM` (expected absent — RN isn't a DOM).
- **Prior art says these are CDP-native (no app changes):** Console, Network (incl.
  response inspection), Runtime.evaluate, HeapProfiler sampling, Debugger. Confirm each
  on our versions rather than assume.
- **The pivotal output is the hybrid boundary:** confirm which vision features are
  **CDP-native** vs which need an **in-app bridge** (React component tree / render
  profiling, navigation, Redux/state look bridge-only). This line directly shapes the
  roadmap and ADR-0008.
- Output: a **capability matrix** — "feature → CDP-native | needs in-app bridge |
  impossible" — feeding M1/M3+ scoping.

### Phase 5 — Decide & write up (½ day)
Fill the report template; apply the rubric; set ADR-0008's status.

---

## Go / No-Go rubric

Criteria are tiered. **P0 = must, or it's not Option A.** The verdict is a function of
which tier fails and for which fixtures.

| ID | Criterion | Tier |
|----|-----------|------|
| C1 | Discover targets + connect CDP for **bare RN** | P0 |
| C2 | `Runtime.evaluate` result + `console.log` captured (bare RN) | P0 |
| C3 | Robust reconnect across app reload + Metro restart | P0 |
| C4 | Same as C1–C2 for **Expo dev-client** | P1 |
| C5 | Coexists with user's own RN DevTools via a working **multiplexing proxy** (or a clear, acceptable handoff model) | P1 |
| C6 | Same as C1–C2 for **Expo Go** | P2 |
| C7 | Network request/response bodies available over CDP | P2 (prior art says yes — confirm; shapes Network feature scope) |
| C8 | Capability matrix drawn: CDP-native vs in-app-bridge line established | P1 (decides the hybrid architecture) |

### Verdict matrix

| Outcome | Meaning | Action |
|---------|---------|--------|
| **GO** | C1–C3 pass; C4–C5 pass or have a clear path | Accept ADR-0008 Option A. Proceed to Track B / M1 as planned. |
| **CONDITIONAL GO** | C1–C3 pass (bare RN) but C4/C5 constrained (e.g. Expo dev-client needs a workaround, or coexistence requires a "take over DevTools" handoff) | Accept Option A **scoped to what works**; log the constraints; adjust M1 project-detection & UX; revisit Expo path. Update OQ-3/OQ-20. |
| **NO-GO** | Any P0 (C1–C3) fails with no workaround | ADR-0008 → **superseded by a fallback ADR** for Option B (in-app agent). Replan M1: ship an RN package, accept per-version maintenance, revisit affected non-goals. |

We explicitly allow **CONDITIONAL GO** — reality here is unlikely to be binary, and
pretending it is would be the fake-certainty trap.

> **Expected outcome, given prior art (stated as a prediction, not a result):** most
> likely a **GO / CONDITIONAL GO with a hybrid architecture** — CDP-native for
> Console/Network/Runtime/Heap/Debugger, plus an optional in-app bridge for RN-semantic
> features (component tree, navigation, state). The spike's real value is now **confirming
> our versions, proving the multiplexing proxy, and pinning the CDP-vs-bridge line** —
> not answering a coin-flip. A hard NO-GO looks unlikely but is not ruled out until we
> reproduce it ourselves.

---

## Deliverables

1. **`docs/engineering/reports/cdp-spike-report.md`** — the go/no-go report (template
   below), with raw captures attached (target-list JSON, CDP transcripts).
2. **Capability matrix** (Phase 4) — feeds M1/M3+ scoping.
3. **ADR-0008 status update** (Accepted / Conditional / Superseded-by-fallback).
4. **OQ updates:** OQ-4, OQ-5, OQ-14, OQ-20 flipped to 🟢 with findings.
5. The throwaway spike code, clearly marked disposable, retained only for reproduction.

### Report template (skeleton)

```
# CDP Spike Report — <date>
## Versions tested        (RN / Expo / Hermes / Metro / OS / device)
## Verdict                GO | CONDITIONAL GO | NO-GO   + one-paragraph why
## Criteria results       C1..C7 pass/fail/partial, per fixture, with evidence
## Discovery findings     endpoints, ports, multi-instance (HR-1)
## Connect/read findings  transcripts of evaluate + consoleAPICalled
## Lifecycle findings     reconnect behavior across reload/restart
## Coexistence findings   DevTools multi-client behavior (OQ-14)
## Capability matrix      domain -> supported/partial/absent, feature implications
## Recommended next step  concrete effect on ADR-0008 and M1 scope
## Open risks carried forward
```

---

## What this spike is NOT

- Not production code, not a `ProtocolClient` implementation (that's built _after_ a GO,
  behind Core's `protocol/` slot).
- Not a UI. Node + `ws` + `fetch` only; output to console/files.
- Not exhaustive across every RN version — it's a **point-in-time feasibility check** on
  current-stable versions, and the report says so.

## Risks to the spike itself

| Risk | Mitigation |
|------|------------|
| Endpoints/behavior differ from the hypotheses above | That's the point — the spike _discovers_ the real surface; hypotheses just seed where to look first. |
| Expo Go is too constrained to matter | It's P2 — a fail there is a documented limitation, not a gate failure. |
| We rabbit-hole past the time-box | The ≤5-day box is a hard stop; inability to conclude leans the verdict toward CONDITIONAL/NO-GO and escalates. |

---

## Prior art & sources (researched 2026-07-25)

These inform the confirmed facts above. **We study the _approach_, not copy code** —
licensing and maintenance ownership must be checked before reusing anything.

- **`@react-native/dev-middleware`** — the official RN package providing the Inspector
  Proxy and CDP endpoints. The authoritative surface we build against.
- **`metro-mcp`** (steve228uk) & **metromcp.dev** — an existing tool that connects to
  Metro over CDP with no app changes for most features, implements the **multiplexing
  proxy** for the single-Hermes-connection constraint, and documents the CDP-native vs
  `__METRO_BRIDGE__`-required split. Strong existence proof for Option A's core.
- Facebook/react-native issue #56471 (Hermes CDP heap-snapshot edge case) — a reminder
  that CDP-over-Hermes has real rough edges (e.g. large-payload/WebSocket limits) we
  should probe under load.
- expo/expo issue #17843 (Hermes debug WS URL IPv6 quirk) — a concrete Expo-specific
  discovery gotcha to watch for in Phase 1.

Sources:
- [@react-native/dev-middleware (npm)](https://www.npmjs.com/package/@react-native/dev-middleware)
- [metro-mcp (GitHub)](https://github.com/steve228uk/metro-mcp) · [metromcp.dev tools](https://metromcp.dev/tools.html)
- [react-native#56471](https://github.com/facebook/react-native/issues/56471)
- [expo#17843](https://github.com/expo/expo/issues/17843)
