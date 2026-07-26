# 21 — M2 Plan: AI Data-Boundary (E-12) & Grounded Assistant (E-13)

- **Milestone:** [M2 — AI Assistant Grounded in Context](../planning/07-milestones.md)
  (thin slice). Delivers the headline differentiator, responsibly.
- **Why decompose now:** M2 was gated on two product decisions and the existence of real
  context to reason over. All three preconditions are now met: **OQ-6** ([ADR-0010](../adr/ADR-0010-telemetry-opt-in.md)),
  **OQ-7** ([ADR-0011](../adr/ADR-0011-ai-provider-byok-swappable.md)), and **OQ-9**
  ([ADR-0012](../adr/ADR-0012-unified-log-persistence.md)) are resolved, and E-10's unified
  log + `DebugContextStore` are live on `main`. Decomposing earlier would have been the
  "fake certainty" the M0 plan warned against; decomposing now is grounded.
- **The one hard rule of M2:** _no debug data leaves the machine except through the E-12
  boundary, redacted, with the user's per-send consent._ E-13 is built **on top of** that
  boundary, never around it. This is the TR-5 mitigation and the trust posture the whole
  product rests on.

> Sizes: **S ≤ ½ day · M 1–2 days · L 3–5 days**. `core` stays Electron-free (ADR-0002,
> lint-enforced). The Anthropic SDK and any network egress live outside `core` (see E-13).

---

## Guardrails inherited from the ADRs (build to these, don't re-litigate)

- **BYOK-Claude-first, direct from the machine** ([ADR-0011](../adr/ADR-0011-ai-provider-byok-swappable.md)):
  requests go straight from the user's machine to Anthropic with the user's own key via
  `@anthropic-ai/sdk`. Icarus runs **no backend**, holds **no key**, and sees **no context**.
  A narrow, swappable `AIProvider` interface; a local provider is a documented follow-on,
  **not** in M2. Default model `claude-sonnet-5` (interactive), `claude-opus-5` for deeper
  reasoning; model is configuration, not architecture.
- **AI is optional** (mission principle): no key → the assistant is inert and the rest of
  Icarus is unaffected. Nothing in M2 may make AI a requirement.
- **Sending context to the AI is its own consent, distinct from telemetry**
  ([ADR-0010](../adr/ADR-0010-telemetry-opt-in.md)). Telemetry and debug data never mix;
  the E-12 send-consent is a separate, per-use gate.
- **No autonomous actions** (NG-6): the assistant answers questions over captured context.
  It does not touch the device, the repo, or the running app.
- **Redaction is mandatory, not a preference:** the user controls _which categories_ of
  context to include; secret/PII redaction of whatever is included is always on.

---

## Part A — E-12 · AI data-boundary & redaction

### Goal

One explicit, visible, testable choke point through which — and only through which — any
debug context can be assembled for the model, with secrets/PII redacted and the user shown
exactly what will leave before it leaves (TR-5). E-12 _is_ the mitigation, not a feature
bolted onto one.

### Why it's high-value / high-risk

This is the epic that decides whether a developer trusts Icarus with their real app. Get it
right and every future AI feature inherits a safe boundary; get it wrong — one leaked token
in a payload — and the product's core promise is broken in a way no feature can win back.
It is the highest-trust-leverage code in the whole plan, so we build it to a **canary-tested**
bar: a planted fake secret must never cross the boundary.

### Design contract (what we're building to)

`core`, Electron-free, pure where possible:

```
// The single assembly point. Nothing reaches a provider except its output.
buildAiSendPayload(bundle: ContextBundle, cfg: RedactionConfig): SendPayload

interface ContextBundle {           // selected, bounded, model-ready context
  readonly logs?: readonly UnifiedLogEntry[];      // from the live unified log
  readonly network?: readonly CdpNetworkEvent[];   // request/response metadata
  readonly question: string;
}
interface SendPayload {
  readonly text: string;            // exactly the bytes that will be sent
  readonly report: RedactionReport; // what was scrubbed, by category + counts
  readonly approxTokens: number;    // budget/΅cost visibility
}
redact(text: string): { text: string; hits: RedactionHit[] }  // pure, ordered rules
```

- **Bounded by construction:** the bundle is size/token-capped (drop-oldest, keep-recent —
  reuse the E-03s ring discipline), so a huge log can't blow the budget or the payload.
- **Redaction is precision-first:** an ordered rule set (JWT, `Authorization`/bearer, common
  API-key shapes, emails, absolute home paths, obvious `key=`/`token=` assignments) that errs
  toward _not_ mangling ordinary log lines; every hit is reported by category.
- **The report is the source of truth for the UI** "what gets sent" surface.

### Tasks — E-12

| # | Task | Size | Depends | Notes |
|---|------|------|---------|-------|
| T-12.1 | `redact(text)` + rule set + `RedactionHit`/`RedactionReport` types, in `core/ai/redaction` | M | E-10 (live) | Pure; precision-first; heavy unit tests incl. false-positive guards |
| T-12.2 | Redact structured context (unified-log entries, network URLs/headers) → combined `RedactionReport` | M | T-12.1 | Applies rules to entry text + network fields |
| T-12.3 | `ContextBundle` selection + serialization: bounded, token-capped, category-filtered view of `DebugContextStore` + log snapshot | M | E-10 | Drop-oldest/keep-recent; `approxTokens` estimate |
| T-12.4 | `buildAiSendPayload` — the single boundary assembly; invariant "nothing bypasses this" | S | T-12.1–3 | The choke point every provider call must use |
| T-12.5 | IPC + renderer **"what gets sent" preview**: exact redacted text + report + a **per-send consent** gate (distinct from telemetry) | M | T-12.4 | The visible, user-controllable surface (exit criterion) |
| T-12.6 | User controls: category toggles (logs / network), mandatory-redaction indicator, **Send / Cancel** | S | T-12.5 | Categories opt-in; redaction not disableable |
| T-12.7 | **Canary boundary test:** plant a fake secret in captured context, assert it's redacted at `buildAiSendPayload` and never appears in a payload | M | T-12.4 | The E-12 hard gate; unit + a wired boundary test |

### Definition of Done — E-12

- Every path that could send context goes through `buildAiSendPayload` (grep/boundary test);
  there is no second way to assemble a payload.
- **The canary test passes:** a planted secret never crosses the boundary. This is the gate.
- The user sees the _exact_ redacted bytes + a redaction report and must approve **per send**;
  the consent is separate from telemetry (ADR-0010).
- Category selection works; redaction is always-on and clearly indicated.
- `core/ai` has zero Electron imports; all redaction/selection logic unit-tested without a shell.

### Risks — E-12

| Risk | Mitigation |
|------|------------|
| A secret slips through (TR-5) | Single choke point + canary test + precision rules; report surfaces anything scrubbed. |
| Over-redaction mangles useful logs | Precision-first rules with false-positive unit tests; categories let the user narrow scope instead of us over-scrubbing. |
| "Visible boundary" becomes a rubber-stamp | Per-send consent shows real content + counts, not a blanket "allow AI" toggle. |
| Payload too large / costly | Token-capped bundle with `approxTokens` shown before send. |

---

## Part B — E-13 · Grounded assistant (thin slice)

### Goal

An assistant that reads a `DebugContextStore` snapshot and **answers questions using data the
user did not paste** (G-6), through the E-12 boundary, with no autonomous actions (NG-6).

### Why it's high-value / high-risk

This is the headline differentiator — and the one most able to poison perception if it's weak
(PR-2). The mitigation is a discipline, not a feature flag: **ship it only when it demonstrably
answers from captured context**, and keep it a thin Q&A slice (no agents, no actions) so the
first impression is "it already knows what my app just did," not "it's a chatbot I have to feed."

### Design contract (what we're building to)

```
interface AIProvider {                          // ADR-0011; swappable
  ask(req: AiRequest): AsyncIterable<AiChunk>   // streamed, grounded answer
}
// Anthropic impl lives OUTSIDE core (@icarus/ai), behind this interface.

interface KeyStore { get(): Promise<string | null>; set(k: string): Promise<void>; clear(): Promise<void> }
// Desktop impl uses Electron safeStorage (OS keychain) — never plaintext, never transmitted.

askAssistant(question, ctx, provider): AsyncIterable<AiChunk>
//   builds ctx via E-12 buildAiSendPayload → provider.ask → streams grounded answer.
```

- **Package boundary:** the `AIProvider` interface + orchestration live in `core` (Electron-free,
  no SDK). The **Anthropic implementation** lives in a new small **`@icarus/ai`** package that
  depends on `@anthropic-ai/sdk`, so the heavy dep and the only network egress stay out of `core`
  and behind the swappable seam (ADR-0011). Swapping in the local provider later touches only
  this package.
- **Grounding, not chat:** the orchestrator always attaches the E-12 payload; the UI shows the
  answer _next to_ "what it was grounded on."
- **Optional by construction:** no key in the `KeyStore` → the assistant reports "add a key to
  enable" and nothing else in Icarus changes.

### Tasks — E-13

| # | Task | Size | Depends | Notes |
|---|------|------|---------|-------|
| T-13.1 | `AIProvider` interface + `AiRequest`/`AiChunk` (streaming) types in `core/ai` | S | — | Electron-free; no SDK in core |
| T-13.2 | `@icarus/ai` package: Anthropic provider via `@anthropic-ai/sdk` (default `claude-sonnet-5`, configurable), streaming, error/refusal/timeout mapped behind the interface | M | T-13.1 | Direct BYOK call; the only network egress |
| T-13.3 | `KeyStore` interface (core) + Electron `safeStorage`-backed impl (desktop) + set/clear key in settings | M | T-13.1 | Never plaintext, never transmitted; AI-optional hinges on this |
| T-13.4 | `askAssistant` orchestrator (core): question → `buildAiSendPayload` → `provider.ask` → grounded stream; enforces the boundary + NG-6 | M | T-12.4, T-13.1 | No tool/agent loop; answers only |
| T-13.5 | Wire the assistant as a **FeatureModule** (ADR-0007) + IPC: a command to ask, a subscription to stream chunks | M | T-13.4 | Adding it touches no core wiring (registry auto-binds) |
| T-13.6 | Renderer Q&A panel: question input, streamed answer, inline "grounded on / what was sent" linking the E-12 preview; graceful no-key state | M | T-13.5, T-12.5 | The user-facing thin slice |
| T-13.7 | **Grounding acceptance test:** seed a known error into captured context, ask about it, assert the answer used non-pasted data and stayed within the E-12 boundary | M | T-13.6 | The G-6 / PR-2 gate |

### Definition of Done — E-13

- The assistant **answers using data the user did not paste** (the grounding test proves it) —
  the G-6 exit criterion.
- Every answer is assembled through the E-12 boundary; there is no un-redacted path to the model.
- **AI is fully optional:** with no key, the panel explains how to enable and the rest of Icarus
  is unaffected; with a key, the request goes machine→Anthropic directly (no Icarus backend).
- No autonomous actions (NG-6): the assistant reads and answers; it never acts.
- `core/ai` stays Electron-free and SDK-free; the SDK lives only in `@icarus/ai`.

### Risks — E-13

| Risk | Mitigation |
|------|------------|
| Weak first AI poisons perception (PR-2) | Ship only when the grounding test passes; keep it a focused Q&A slice, not an over-promised agent. |
| Key mishandling | `safeStorage` (OS keychain), never plaintext, never in a `FileStore`, never transmitted; user sets/clears it. |
| Provider latency/cost surprises | Streamed UI; `approxTokens` shown pre-send (E-12); user's own key and bill; model configurable. |
| Scope creep toward autonomy | NG-6 is a hard line in the orchestrator: no tool loop, no actions — answers only. This M2 slice ships without them. |
| Offline expectation | AI is explicitly optional; the offline/local provider is an ADR-0011 follow-on, not M2. |

---

## How E-12 and E-13 meet the M2 exit criteria

| M2 exit criterion | Story | Met by |
|---|---|---|
| Assistant answers using data the user did **not** paste (G-6) | [US-11](../planning/09-user-stories.md) | E-13 T-13.4/6/7 (grounding test is the gate) |
| "What gets sent" is visible and user-controllable; redaction pass in place | [US-12](../planning/09-user-stories.md) | E-12 T-12.5/6/7 (preview + per-send consent + canary test) |
| OQ-6 / OQ-7 resolved and documented (ADR) | — | Done pre-M2: [ADR-0010](../adr/ADR-0010-telemetry-opt-in.md) / [ADR-0011](../adr/ADR-0011-ai-provider-byok-swappable.md) (OQ-9 also, [ADR-0012](../adr/ADR-0012-unified-log-persistence.md)) |

## Sequencing note

**E-12 before E-13** — the boundary is the foundation, not a follow-up. Suggested order that
keeps `main` releasable and front-loads the trust-critical pieces:

1. E-12 redaction core (T-12.1 → T-12.2) and the context bundle (T-12.3) — parallelizable, pure `core`.
2. The boundary assembly (T-12.4) + its **canary test** (T-12.7) — the gate lands before any UI.
3. The "what gets sent" surface + controls (T-12.5 → T-12.6).
4. In parallel with 1–3: the `AIProvider` interface + `@icarus/ai` Anthropic impl + `KeyStore`
   (T-13.1 → T-13.2, T-13.3) — none of these send anything until wired through the boundary.
5. Orchestrator (T-13.4) → module + IPC (T-13.5) → Q&A panel (T-13.6) → grounding test (T-13.7).

Because AI is optional and inert without a key, every partial state of E-13 leaves the app fully
usable — the assistant simply isn't enabled yet.

## What is intentionally NOT in M2

- **The local / offline provider** — an ADR-0011 follow-on behind the same interface, not M2.
- **Autonomous actions, tool loops, multi-step agents, code edits** — NG-6; out of scope by design.
- **Full session export / long-term history** — a deliberate non-default (see ADR-0012); the
  assistant grounds on the live context, not an archive.
- **Team/cloud features** — Icarus runs no backend (ADR-0011); nothing here changes that.
