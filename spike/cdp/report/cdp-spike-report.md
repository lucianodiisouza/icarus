# CDP Spike Report — <DATE>

> Fill this in as the spike runs. This report — not the spike code — is the deliverable.
> Template mirrors [Doc 19 §Report template](../../../docs/engineering/19-cdp-spike-plan.md).
> Attach raw captures (target-list JSON, CDP transcripts) alongside.

## Versions tested

| Fixture | RN | Expo SDK | Hermes | Metro | OS | Device |
|---------|----|----------|--------|-------|----|--------|
| bare | | — | | | | |
| expo-devclient | | | | | | |
| expo-go | | | | | | |

## Verdict

**GO | CONDITIONAL GO | NO-GO** — _one paragraph on why._

## Criteria results

| ID | Criterion | bare RN | Expo dev-client | Expo Go | Evidence |
|----|-----------|---------|-----------------|---------|----------|
| C1 | Discover + connect | | | | |
| C2 | evaluate result + console captured | | | | |
| C3 | Robust reconnect (reload + Metro restart) | | | | |
| C4 | C1–C2 on Expo dev-client | | | | |
| C5 | Coexists via multiplexing proxy | | | | |
| C6 | C1–C2 on Expo Go | | | | |
| C7 | Network request/response bodies over CDP | | | | |
| C8 | Capability matrix drawn (CDP vs bridge) | | | | |

## Discovery findings (Phase 1)

- Endpoints/ports that worked; multi-instance behavior (HR-1).

## Connect/read findings (Phase 2)

- `Runtime.evaluate` transcript; `consoleAPICalled` captures; exception behavior.

## Lifecycle findings (Phase 3a)

- What happens on app reload / Metro restart; what a robust reconnect loop must do.

## Coexistence findings (Phase 3b — the proxy)

- Does RN DevTools work through the proxy? Latency/overhead? What breaks? (OQ-14)
- If the proxy is infeasible: the fallback hand-off model.

## Capability matrix (Phase 4)

| Feature (vision) | CDP-native | Needs in-app bridge | Impossible | Notes |
|------------------|-----------|---------------------|-----------|-------|
| Console/logs | | | | |
| Network inspection | | | | |
| Runtime evaluate | | | | |
| Heap/memory | | | | |
| Debugger/breakpoints | | | | |
| React component tree | | | | |
| React render profiling | | | | |
| Navigation state | | | | |
| Redux/app state | | | | |

## Recommended next step

- Effect on [ADR-0008](../../../docs/adr/ADR-0008-debugger-protocol-cdp.md) and M1 scope.

## Open risks carried forward

- e.g. large-payload framing (react-native#56471); Expo IPv6 ws quirk (expo#17843).
