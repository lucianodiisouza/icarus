# 23 — M3 Slice 2: Network Inspector Upgrade (E-16)

- **Milestone:** [M3+ — Additive Integrations](../planning/07-milestones.md).
- **What it delivers:** The current `NetworkSection` in the renderer is a flat `tail -f`-style
  list of CDP `Network.*` events. That covers "did the request go out?" and "did the response
  come back?" — but a real network inspector needs **correlated records** (one row per HTTP
  call, not per event), **request + response headers**, **timing** (TTFB, total), **failure
  state**, and the ability to **expand a row** to see everything.
- **Why this slice first (of the remaining M3+ backlog):** the data is already being captured
  (E-14 slice 5) and the renderer has a panel — most of the work is on the model + UI. The
  shape of the work is identical to E-15 (upgrade a captured stream into a proper inspector),
  so the foundation has already proven it carries it.

> Sizes: **S ≤ ½ day · M 1–2 days · L 3–5 days**. `core` stays Electron-free (ADR-0002,
> lint-enforced). The renderer upgrade uses the proven virtualizer / filter-chip pattern
> from the unified-log panel.

---

## Goal

A real network inspector: rows are **HTTP calls**, not raw events. Each row is expandable
to show request/response headers, timing, query params, and (opt-in) request/response bodies.
A "failed" row is visually distinct, sortable by duration/status, and filterable by method
+ status + URL substring.

## Design contract

```
// core (pure, Electron-free)
type NetworkRecord = {
  readonly requestId: string;         // CDP requestId, stable across the call
  readonly url: string;
  readonly method: HttpMethod;        // 'GET' | 'POST' | ...
  readonly status?: number;           // present iff a response arrived
  readonly statusText?: string;
  readonly contentType?: string;
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly responseHeaders?: Readonly<Record<string, string>>;
  readonly requestTimestampMs: number;
  readonly responseTimestampMs?: number;
  readonly endTimestampMs?: number;   // response or failure
  readonly failure?: string;          // errorText from Network.loadingFailed
  readonly requestBody?: string;      // present only if the renderer asked for it
  readonly responseBody?: string;     // present only if the renderer asked for it
};

// desktop (main)
ipc channels:
  command:network.list                 // current snapshot of records (correlated)
  command:network.fetchBody({ requestId, kind: 'request'|'response' })
                                      // opt-in body fetch via Network.getRequestPostData / Response body
  command:network.clear                // wipe the captured records
  event:network.record                 // streamed delta: a record was added or its response/failure arrived
```

**Why an explicit `list` + `clear` + `record` event, not a "snapshot + delta" subscription
like the unified log:** the network inspector is sparse, low-volume per page-load (a typical
RN app issues 5-50 calls per minute, not 1000+ per second), so the per-record push is fine
without a `StreamBatcher` (TR-6). A snapshot-on-subscribe is still useful for late joiners.

**Why the renderer's `list` is "current snapshot":** the renderer doesn't carry the
correlation state in its head — it asks main for the live correlated model. This keeps the
renderer simple and means a single source of truth for the records.

## What changes

1. **`core` model:** introduce a `NetworkRecord` type and a `NetworkRecorder` that owns
   the correlation. `formatNetworkEvent` stays as the low-level CDP-parser (raw events
   from the wire); the recorder takes those events and emits correlated `NetworkRecord`s.
   Pure, unit-testable, no Electron.
2. **`core` additions:** `aggregateNetworkEvents(events: CdpNetworkEvent[]): NetworkRecord[]`
   — a pure function that takes a flat event list and returns the correlated model. The
   recorder wraps this with live state. Both are tested.
3. **`desktop` controller:** `NetworkController` owns the recorder + the IPC channels.
   Exposes `Network.enable` to the CDP session on `cdpConnect` (replacing the current
   ad-hoc wiring in `cdp-ipc.ts`), and feeds `Network.*` events into the recorder.
4. **CDP bodies:** new `core/protocol/cdp/network-body.ts` — wraps `Network.getRequestPostData`
   and `Network.getResponseBody` (the latter is a real round-trip; gated by the renderer's
   opt-in click, never auto-fired).
5. **Renderer:** replace the flat `NetworkSection` with a grouped/filterable panel:
   - One row per call, collapsed by default; click to expand.
   - Status pill (200 green, 3xx blue, 4xx amber, 5xx red, failed = bold red).
   - Method + URL + duration + size (rough, when known).
   - Expanded: request headers, response headers, query params, timing breakdown, "Fetch
     request body" / "Fetch response body" buttons.
   - Filter chips: method (GET/POST/...), status (2xx/3xx/4xx/5xx/failed).
   - Search input filters by URL substring.
   - Virtualized (reuse the E-11 hand-rolled virtualizer — exact same shape).
6. **E-16a header capture:** enable `Network.enable` already happens, but the events
   `requestWillBeSent` and `responseReceived` carry headers we currently drop. Capture them
   into the record. Tests assert headers survive correlation.

## Tasks

| # | Task | Size | Depends | Notes |
|---|------|------|---------|-------|
| T-16.1 | `core/protocol/network/aggregate.ts` — pure `aggregateNetworkEvents(events): NetworkRecord[]` correlation + tests | M | E-14 (events live) | Canary: same `requestId` events end up in one record |
| T-16.2 | `core/protocol/network/recorder.ts` — `NetworkRecorder` class: takes raw `CdpNetworkEvent`s, owns the model, exposes `records()` + `onRecord(handler)`; tests for the live correlation | M | T-16.1 | Mirrors the `UnifiedLogController` shape (a fan-in sink with subscription) |
| T-16.3 | `core/protocol/cdp/network-body.ts` — `fetchNetworkBody(cdp, requestId, kind)` wrapping `getRequestPostData` / `getResponseBody`; size-capped; never throws | S | T-16.1 | Pure wrappper around the CDP client; tested with a fake CDP |
| T-16.4 | `desktop/main/network-controller.ts` — owns the recorder, wires the CDP `Network.enable` + `Network.*` event flow, registers the IPC channels (`list`, `fetchBody`, `clear`, `record` event) | M | T-16.2, T-16.3 | Replaces the ad-hoc `cdp-ipc` network wiring; injection seam for CDP `send` |
| T-16.5 | `desktop` IPC types + Zod schemas in `shared/ipc/contracts.ts` for the 3 channels + the event | S | T-16.4 | Standard Zod discipline; types flow end-to-end |
| T-16.6 | Renderer: replace `NetworkSection` with a grouped/filterable/expandable panel; reuse the unified-log virtualizer | L | T-16.4 | Honest UI: status pill, method, URL, duration, expansion, filter chips, search |
| T-16.7 | Tests: `NetworkRecorder` correlation + header capture + body fetch + the controller's IPC channel + the renderer's filter | M | T-16.1–6 | Same shape as the E-15 test pyramid: core pure, desktop wiring injectable, renderer filterable |

## Definition of Done — E-16

- One row per HTTP call (correlated by `requestId`), not per event.
- Status pill + method + URL + duration visible at a glance.
- Click to expand → request headers + response headers + query params + timing.
- "Fetch response body" is opt-in; auto-fetch is never the default (it costs a CDP round-trip).
- Filter chips (method, status range) + URL substring search work.
- 4xx/5xx/failed rows are visually distinct from 2xx/3xx.
- `core` coverage gate still holds; new code exercised by the canary (correlation) +
  header-capture test + body-fetch test.
- Lint clean, typecheck clean, `pnpm -r test` green, desktop `pnpm build` green, e2e green.
- The previous `NetworkSection` is gone — no two ways to view network calls.

## Explicitly out of scope (deferred)

- **Request/response body fetching for binary payloads** (images, video). v1 is text-only
  (JSON, text/html, form bodies). Binary → show the content-type + size, not the bytes.
- **Editing & replay** (the "modify + resend" feature). That's a separate UX surface, not
  v1.
- **WebSocket frames.** CDP has a separate `Network.webSocketFrame*` event set; we ignore
  them in v1. Trigger: a design-partner asks for it.
- **Request blocking / throttling** (the "slow 3G" toggle). Out.
- **HAR export.** The unified-log export already gives a JSONL of the log; the network
  inspector could share that mechanism for HAR, but it's not a v1 ask.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `getResponseBody` is slow (round-trip to the JS context) and can fail (e.g. response was already GC'd) | Opt-in only; size-capped (e.g. 256 KB); error surfaces as a typed "body unavailable" rather than a crash |
| Header values may contain PII / auth tokens | The E-12 redaction already covers this if we ever run the network events through the boundary; the inspector UI shows headers as-is, which matches dev-tools convention (Chrome DevTools shows auth headers raw) |
| Correlation is fragile if `requestId` is missing (CDP shouldn't omit it, but defense in depth) | The aggregator drops events without a `requestId`; a defensive test asserts this |
| Timing fields are optional in CDP — TTFB / total can be NaN if the response is missing | UI shows "—" instead of "NaNms"; no render explosion |
| The renderer's filter / virtualizer is a near-duplicate of the unified-log one | Reuse the same hand-rolled virtualizer (E-11), no new virtualization lib |
| Existing M1 `NetworkSection` UI is removed in this slice — a regression in the test that captures request/response status lines | The new E2E test asserts the new panel mounts and shows a captured request on a real run |

## Why this slice — and what comes after

The M3+ backlog (vision + closeouts): network inspection, component tree, storage inspectors
(AsyncStorage / MMKV / SQLite), performance, navigation, native logs, device management, build
system. Each is an additive feature module on the proven foundation. After E-16:
- **E-17 — Component tree** (CDP `Runtime.evaluate` to grab the React Fiber tree + props)
- **E-18 — Storage inspectors** (AsyncStorage + MMKV + SQLite — one shared Epic because
  the model + UI is nearly identical)
- **E-19 — Performance** (CDP `Performance` + JS thread ticks)
- **E-20 — Navigation** (React Navigation state via the in-app bridge, OQ-22)
- **E-21 — Release workflow** (sign + notarize + package + distribution)

Ordering: same evidence-driven rule. E-16 first because the data is already being captured
and the upgrade is small. Component tree next because it's the second-most-asked-for
inspector and the CDP primitives are ready.
