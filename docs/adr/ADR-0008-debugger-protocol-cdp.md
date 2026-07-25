# ADR-0008 — Debugger protocol: Origin-authenticated CDP via the Metro inspector proxy (hybrid)

- **Status:** **Accepted** (2026-07-25) — validated by the M0 CDP spike (E-Spike-CDP).
- **Date:** 2026-07-25
- **Deciders:** Staff Engineer / TPM
- **Related:** TR-1 (hardest technical risk — now downgraded), NG-2 (don't build a new protocol), the whole Vision
- **Evidence:** [CDP Spike Report](../engineering/reports/cdp-spike-report.md) · [Spike Plan](../engineering/19-cdp-spike-plan.md)

> **Decision in one line:** Use **CDP through Metro's inspector proxy**, sending an
> `Origin: http://localhost:<metroPort>` header to satisfy the proxy's CSRF check, for
> Runtime/Log/Debugger/Console/**Network** (RN ≥ 0.76); use an **in-app bridge** for
> HeapProfiler/Profiler and RN-semantic data (component tree, navigation, state). Front
> multiple clients with a **multiplexing proxy** (Hermes allows one connection).

## Context

Icarus's differentiating features — component tree, Hermes state, console, network,
performance — depend on getting structured runtime data out of a running RN app. The
ecosystem's official direction is **React Native DevTools**, built on **Hermes exposing
the Chrome DevTools Protocol (CDP)**, reachable through **Metro's inspector proxy**.
Whether a _third-party_ tool can reliably connect to that proxy, enumerate targets, and
drive CDP domains (Runtime, Console, Network, Debugger, HeapProfiler…) across RN
versions is **the single most load-bearing unverified assumption in the whole plan.**

## Options considered

### Option A — Speak CDP to Hermes via Metro's inspector proxy *(proposed, pending spike)*
- **Pros:** It's the _official_ direction (survives ecosystem churn — mitigates PR-3);
  reuses a documented, stable protocol (honors NG-2); potentially lets us reuse parts
  of the RN DevTools frontend; one protocol unlocks many features.
- **Cons / unknowns:** Exact third-party connection handshake, target discovery, multi-
  client behavior (does connecting conflict with the user's own DevTools?), and version
  drift are **unverified**. This is TR-1.

### Option B — Legacy/websocket packager channels or a custom in-app agent (RN bridge module)
- **Pros:** Full control over the data we extract.
- **Cons:** Requires shipping code _into the user's app_ (an npm package they install) —
  higher friction, exactly the Flipper-plugin model whose fragility we're avoiding;
  more maintenance across RN versions. Kept as a **fallback** if Option A fails.

### Option C — Screen-scrape / reuse RN DevTools as an opaque embedded window
- **Pros:** Fastest visual parity.
- **Cons:** We get pixels, not structured context — which defeats the entire premise
  (Context is the product, G-3). The AI can't reason over an iframe. Rejected as a
  primary strategy; possibly a stopgap for a single view.

## Decision

Adopt a **HYBRID**, validated by the spike:

**A — CDP through Metro's inspector proxy (primary transport).**
- Discover targets via `GET /json/list` (unauthenticated); connect to a target's
  `webSocketDebuggerUrl`.
- **Send `Origin: http://localhost:<metroPort>`** on the WebSocket upgrade to satisfy the
  proxy's CSRF check (`WS_DEBUGGER_ALLOWED_ORIGIN_HOSTNAMES` in `dev-middleware`). This is
  the sanctioned mechanism the official DevTools uses — **we do not bypass the control.**
- CDP-native domains (verified): **Runtime, Log, Debugger, Console-via-Runtime**, and
  **Network on RN ≥ 0.76** (request/response events captured live).
- Front the single Hermes connection with a **multiplexing proxy** so Icarus and the
  user's own RN DevTools coexist (Hermes permits one debugger connection).
- **Select the correct target** (the main JS runtime) and defensively time out secondary/
  unresponsive runtimes (e.g. Reanimated's UI runtime).

**B — In-app bridge (secondary transport, for what CDP doesn't expose).**
- For **HeapProfiler/Profiler** (unsupported over CDP even on RN 0.86) and **RN-semantic
  data** — React component tree / render profiling, navigation, Redux/app state — an
  optional in-app bridge (a dev-only package the user installs) supplies structured data.
- This is opt-in and additive; the core loop works without it.

Both transports sit behind the Core `ProtocolClients` / data-source abstraction so
features consume normalized data, not a specific wire.

## Rationale

This is the only option that avoids building a new protocol (NG-2), rides the ecosystem's
official direction (`dev-middleware` / RN DevTools, mitigating PR-3), and yields
_structured_ context (G-3). The spike **removed the uncertainty** that made it provisional:
CDP works as a third party with zero app changes; the one real gate (a 401) turned out to
be a standard **Origin CSRF check** solved with a single header; and **Network — a
flagship feature — is CDP-native on modern RN**, richer than first assumed. The residual
gaps (Heap/Profiler, RN-semantics) are bounded and handled by the opt-in bridge, keeping
the friction Option-B-only where it's unavoidable rather than for the whole product.

## Consequences

- **Positive:** CDP is the backbone data source; many features become "consume a CDP
  domain." Network ships without an in-app agent on modern RN. Aligned with the official
  tooling, so upstream changes are contained to our proxy/transport layer.
- **Accepted trade-offs / follow-ups:**
  - We must **mirror `dev-middleware`'s Origin/allowlist expectations** and track its
    changes across RN versions (OQ-21).
  - We must **build and maintain the multiplexing proxy** (a real component, planned in
    M1) and robust **target selection + timeouts** (both surfaced by the spike).
  - **Heap/Profiler/RN-semantics require the in-app bridge** — its design (scope, install
    UX, versioning) is a future ADR when those features are scheduled.
  - **Version sensitivity:** Network requires RN ≥ 0.76; older apps get the reduced CDP
    set. Icarus should detect and degrade gracefully.
- **Superseded framing:** the earlier "raw CDP vs. in-app agent, pick one" framing is
  retired — it is both, with a clear line between them.

## Open questions this leaves

- **OQ-4:** ✅ **resolved** — third-party CDP via the proxy is feasible (Origin-authed).
- **OQ-14:** ✅ **resolved** — coexistence requires a multiplexing proxy (Hermes = one
  connection); confirmed empirically.
- **OQ-21 (new):** how to robustly mirror `dev-middleware`'s Origin/allowlist and track it
  across RN versions; where the multiplexing proxy lives in the architecture.
- **Deferred:** the in-app bridge's design (Heap/Profiler/RN-semantics) — its own ADR when
  scheduled. Whether HeapProfiler ever appears over CDP on a future RN — re-probe later.
