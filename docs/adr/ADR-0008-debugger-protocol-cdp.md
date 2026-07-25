# ADR-0008 — Debugger protocol: CDP via the Metro inspector proxy

- **Status:** **Proposed — GATED on the M1 spike (TR-1). Not to be accepted until validated.**
- **Date:** 2026-07-25
- **Deciders:** Staff Engineer / TPM
- **Related:** TR-1 (hardest technical risk), NG-2 (don't build a new protocol), the whole Vision

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

## Decision (provisional)

**Provisionally choose a HYBRID of Option A + Option B**, gated on the M0 spike (Epic
E-Spike-CDP) reproducing it on our target versions.

> **Update 2026-07-25 (web research — see [Spike Plan §Sources](../engineering/19-cdp-spike-plan.md)).**
> Prior art (`@react-native/dev-middleware`, `metro-mcp`) confirms the core of Option A
> is **feasible as a third party with no app changes** for Console, Network, Runtime,
> HeapProfiler, and Debugger. It also reveals two things that reshape this decision:
> (1) **Hermes allows only one CDP debugger connection**, so coexistence with the user's
> own DevTools requires a **multiplexing proxy** (a known, proven pattern) — this is the
> real engineering, not the connection itself; and (2) **RN-semantic features** (React
> component tree/render profiling, navigation, Redux/state) appear to need an **in-app
> bridge**, i.e. Option B, for those specific domains. The right answer is therefore
> **not A-vs-B but A-for-runtime + B-for-RN-semantics.** The spike now _confirms and
> measures_ rather than _discovers_; a hard no-go looks unlikely. This ADR stays
> **Proposed** only until we reproduce it on our tested versions.

## Rationale

Option A is the only option that both avoids building a new protocol (NG-2) and rides
the ecosystem's official current (PR-3) while yielding _structured_ context (G-3). But
its feasibility is genuinely unknown, and honesty (no fake certainty) requires we treat
it as a hypothesis to test, not a fact. If the spike fails, Option B (an in-app agent)
becomes the likely path and the roadmap, footprint, and even parts of the vision change
materially — which is exactly why we spike it in M1, before committing build effort.

## Consequences

- If validated: CDP becomes the backbone `ProtocolClient`; many features become
  "consume a CDP domain." ADR moves to Accepted.
- If invalidated: we replan around Option B (ship an RN package), accepting higher
  integration friction and per-version maintenance, and revisit the roadmap and several
  Non-Goals.
- Either way: keep protocol access behind the Core `ProtocolClients` abstraction so
  features don't hard-code the transport.

## Open questions this leaves

- OQ-4: the entire feasibility question above — **the highest-priority open question.**
- OQ-14: multi-client behavior — can Icarus and the user's own RN DevTools coexist on
  one app instance?
