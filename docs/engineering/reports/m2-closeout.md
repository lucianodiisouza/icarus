# M2 Closeout — AI Assistant Grounded in Context (thin slice) — 2026-07-26

> The M2 differentiator is **built, on `main`, and gated by tests**: a BYOK-Claude
> assistant answers a developer's question over the **live captured context** (unified log
> + network), and every send crosses a **visible, consent-gated data boundary** that
> redacts secrets/PII by construction. The trust-critical invariants — "nothing reaches a
> provider except a redacted `SendPayload`" (canary) and "the answer is grounded on
> non-pasted data" (grounding test) — are enforced in CI. The **engineering** exit criteria
> are met; what remains is **validation** — a real run against a live model with a BYOK key.

## Verdict

**Engineering-complete; awaiting live-key (design-partner) validation.** A developer can
enter their Anthropic key, ask "why did login fail?", **review the exact redacted bytes**,
send, and stream a grounded answer — all without pasting context by hand. The two hard
gates hold automatically: the **canary** (a planted secret never crosses `buildAiSendPayload`)
and the **grounding acceptance test** (a crash error present only in captured logs — never
in the question — is what the answer is built from, while a secret in that same context is
redacted before egress). What M2 has _not_ earned yet: a real run against the **live
Anthropic API** with a user's key on a real debugging session (the tests fake the provider
by design). That's the honest gap between "the boundary and grounding are proven by
construction" and "M2 is validated with a human and a real model."

## What shipped — the boundary + the assistant

All on `main`, across the two M2 epics:

| Epic | What it does |
|---|---|
| E-12 (AI data-boundary) | `redact()` precision scrubber (secrets/PII); bounded, token-capped, category-filtered `ContextBundle`; `buildAiSendPayload` — the single choke point that redacts the whole serialized context as its last step; the **canary** boundary test |
| E-13 (Grounded assistant) | `AIProvider` seam + `askAssistant`/`askWithPayload` orchestrator (Electron-free `core`); `@icarus/ai` Anthropic provider (BYOK, streaming — the only network egress); OS-encrypted `KeyStore` (`safeStorage`, never plaintext); desktop wiring + per-window review/send IPC; the renderer Q&A panel; the **grounding acceptance test** |

## Delivery — this milestone (7 PRs)

| PR | Item | Effect |
|---|---|---|
| #42 | E-12 T-12.1 — redaction pass | Pure secret/PII scrubber with false-positive guards; the boundary's core rule set. |
| #43 | E-12 T-12.2–4/7 — core boundary | Context bundle + `buildAiSendPayload` single choke point + the canary test. Nothing serializes context without redacting it. |
| #44 | E-13 T-13.1/4 — seam + orchestrator | `AIProvider` interface + `askAssistant`; the boundary is the only door to a provider, no tool/action surface (NG-6). |
| #45 | E-13 T-13.2 — `@icarus/ai` | Anthropic provider (default `claude-sonnet-5`, configurable), streaming; the only place the SDK + network egress live. |
| #46 | E-13 T-13.3 — secure KeyStore | BYOK key OS-encrypted at rest via `safeStorage`; never plaintext, never transmitted. AI-optional hinges on this. |
| #47 | E-13 T-13.5/6/7 — thin slice | Desktop wiring + IPC, renderer panel, and the **grounding acceptance test** (G-6 gate). Also extracted CDP wiring to keep `index.ts` thin. |
| #48 | E-12 T-12.5/6 — pre-send consent gate | Review the exact redacted bytes → Send/Cancel, made **sound**: main builds the payload once and sends _that_ payload, so the sent bytes are byte-for-byte the reviewed bytes. |

## Exit-criteria scorecard (honest)

M2's three exit criteria (`docs/planning/07-milestones.md`):

| # | Criterion | Status |
|---|---|---|
| 1 | Assistant answers using data the user did **not** paste (G-6) | 🟩 **Met, gated by an automated test.** The grounding acceptance test (T-13.7) seeds a crash error into captured logs only — never the question — and asserts the answer is built from it, through the real `AssistantBridge` + real boundary. 🟨 The remaining step is a **live** run against the Anthropic API with a BYOK key (the test fakes the provider by design) — validation, not engineering. |
| 2 | "What gets sent" is visible and user-controllable; redaction pass in place | 🟩 **Met (2026-07-26).** E-12 redaction (#42) + the canary boundary (#43); the pre-send **consent gate** (#48) shows the exact redacted bytes + report and requires explicit Send/Cancel; category toggles narrow scope while redaction stays always-on. The gate is sound (sends exactly what was reviewed), not a rubber-stamp. |
| 3 | OQ-6 and OQ-7 resolved and documented (ADR) | 🟩 **Met (pre-M2, #35).** ADR-0010 (telemetry opt-in) and ADR-0011 (AI provider = BYOK, swappable behind the interface). OQ-9 also resolved (ADR-0012). |

## Test & CI posture

- **326 unit tests**: 265 `core` · 6 `@icarus/ai` · 55 desktop — plus **10 Electron E2E** (3 app-smoke + 2 reaper + 5 security).
- The two trust gates are ordinary tests that run on every PR: the **canary** (planted secret never crosses the boundary) and the **grounding** acceptance test (answer uses non-pasted data; secret in the same context redacted).
- CI enforces, on every PR: typecheck · lint (incl. the no-Electron-in-`core` boundary rule and typed `no-floating-promises`) · format · unit tests with the `core` coverage gate · build · the Electron E2E job (macOS + ubuntu).
- `core` coverage: **87.87%**, gated at 80% (ratchets up; was 83.7% at M1).

## Architecture review

The foundation held; **no core changes were forced by M2.** `core` stayed Electron-free
(ADR-0002) — all redaction/bundling/orchestration is unit-tested without a shell, which is
why the two trust gates live in fast unit tests, not slow E2E. Three decisions worth
recording:

- **The boundary is the only door — by construction.** A `SendPayload` is only ever produced
  by `buildAiSendPayload`. The consent gate (#48) exploits this: `askWithPayload` defers the
  send of an already-built payload, so review→send changes _when_ a payload is sent, never
  _what_. The main process caches the reviewed payload per-window; the renderer never
  re-derives or supplies payload bytes. That's what makes the gate sound rather than a
  TOCTOU rubber-stamp.
- **The assistant is not a `FeatureModule` — deliberately.** The `ModuleRegistry` pattern is
  for fire-and-forget event emitters auto-wired to windows; the assistant is
  request/response + a cancellable stream, which fits the validated IPC router + a per-window
  subscription (the same shape as the unified-log stream). Divergence from the T-13.5 plan
  wording, made on purpose.
- **`index.ts` stays a thin orchestrator.** M2's wiring extracted into `assistant-ipc.ts`
  and `cdp-ipc.ts` (a pure move) to respect the 400-line rule and keep the entry declarative.

## Open debt carried into M3

Nothing here is a surprise; each has a trigger:

- **Live-key validation (exit #1's residual)** — a real BYOK run against the Anthropic API on
  a real debugging session, plus M1's deferred A-4 probe (hand a store snapshot to an LLM
  once). Both need a human + a key in the loop, not more code.
- **Local / offline provider** — an ADR-0011 follow-on behind the same `AIProvider` interface;
  explicitly **not** M2.
- **Answer streaming is per-delta `setState`** — fine for an answer stream; not the coalesced
  batching the high-rate log path needed (TR-6). Trigger: if answers get long/chatty enough
  to jank the panel.
- Accepted / trigger-gated from earlier: Android via `adb` (TD-13), Windows tree-kill parity
  (TD-12), Turborepo cache (TD-03), Electron footprint (TD-02), in-process module isolation
  (TD-01).

## M2 → M3 gate

M3+ is the **additive-integrations backlog** (network inspection, component tree, storage
inspectors, performance, …), each an additive feature-module Epic on the now-proven
foundation. Per the roadmap, **ordering is driven by design-partner evidence, not guessed
now** — so the next buildable step is a product-priority call, not an engineering one. M2
leaves **no open engineering** on the AI slice; the remaining AI work is the live-key
validation run above. The foundation (Electron-free `core`, the module SDK, the data
boundary) is ready to carry the first M3 feature module without core changes.
