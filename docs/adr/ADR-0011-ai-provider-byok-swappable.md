# ADR-0011 — AI provider: a swappable interface, BYOK-Claude first, local later

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** Staff Engineer / TPM (product decision, OQ-7)
- **Related:** OQ-7 (the open question this closes), TR-5 (AI context can leak
  source/tokens/PII), PR-2 (over-promising the AI), G-6 (assistant answers over captured
  context), E-12 (AI data-boundary), E-13 (grounded assistant), NG-6 (no autonomous
  actions), the mission principles "AI is an enhancement, never a requirement" and
  "offline-first whenever possible", ADR-0010 (telemetry consent).

## Context

M2's assistant (E-13) reads a `DebugContextStore` snapshot and answers questions over it.
That snapshot is sensitive (source, logs, possibly tokens/PII — TR-5). We must decide
**how the assistant reaches a model**: a local model, a hosted API we operate, or the
user's own key to a provider — with the constraints that AI must stay optional (an
enhancement, not a requirement), the design must be offline-first-friendly, and TR-5
says the architecture must "keep it swappable." The choice also sets who, if anyone,
sees the user's debug context.

## Options considered

### Option A — A swappable provider interface; BYOK-Claude first, local later *(chosen)*
- A narrow `AIProvider` interface (send a bounded context + prompt, get a grounded
  answer). Ship **bring-your-own-key first**: the user supplies their own Anthropic API
  key, and requests go **directly from the user's machine to the provider** — never
  through an Icarus-operated backend, so Icarus holds no key and sees no debug context.
  Default provider: Anthropic Claude via the official `@anthropic-ai/sdk` (a current
  model such as `claude-sonnet-5` for the interactive default, `claude-opus-5` for
  deeper reasoning; model is configurable). A **local-model** provider (e.g. Ollama) is
  a documented follow-on behind the same interface for the offline / maximum-privacy
  user.
- **Pros:** AI stays optional (no key → the rest of Icarus is unaffected); Icarus runs
  no inference infra and **never sees user data**; good grounded-reasoning quality via
  current Claude models; honors "keep it swappable" (TR-5) by construction; the E-12 data
  boundary + redaction still gate exactly what leaves the machine, per user consent.
- **Cons:** BYOK still sends (redacted, consented) context to a third-party API — not
  fully offline until the local provider lands; the user needs their own API key and
  bears the cost; two providers to maintain over time.

### Option B — Local model only (e.g. Ollama)
- **Pros:** Fully offline; maximal privacy — no third party ever sees the context.
- **Cons:** Weaker grounded-reasoning quality risks a poor first AI experience (PR-2 —
  "a weak first AI could poison perception"); heavy footprint (conflicts with NG-8); real
  setup friction (model download, hardware). Good as an *option*, wrong as the *only*
  path.

### Option C — Hosted API we operate (we hold the key)
- **Pros:** Best UX (nothing for the user to configure); we could tune prompts centrally.
- **Cons:** **We would see the user's debug context** — the worst outcome for TR-5 and
  the trust posture of a debugging tool; we'd run and pay for inference infra; conflicts
  with offline-first. Rejected.

## Decision

**Option A.** A narrow, swappable `AIProvider` interface. **Ship BYOK-to-Claude first**
— requests go directly from the user's machine to Anthropic using the user's own key,
via the official `@anthropic-ai/sdk`; Icarus operates no backend and never holds the key
or sees the context. A **local-model provider is a documented follow-on** behind the same
interface. AI remains fully optional.

## Rationale

Only Option A satisfies every hard constraint at once: AI stays an enhancement (no key,
no problem); Icarus never becomes a data processor for user debug context (the decisive
TR-5 win over Option C); quality is good enough out of the gate to avoid PR-2 (unlike
Option B alone); and the interface is swappable by construction, so the local/offline
provider — and any future provider — slots in without touching E-13's reasoning code.
BYOK also aligns the cost and trust model with a developer tool: the user's key, the
user's data, the user's bill. E-12's redaction and visible "what gets sent" boundary
remain the gate on *what* leaves — this ADR only fixes *where it goes and who runs it*.

## Consequences

- **Positive:** No inference infra or key custody for Icarus; user debug context never
  reaches an Icarus server; AI is cleanly optional; the provider seam makes local/offline
  a follow-on, not a rewrite; model choice is a config detail, not an architectural one.
- **Negative / accepted:** BYOK is not offline until the local provider ships; the user
  must obtain and store their own API key (handled by the OS/secure store, never by an
  Icarus backend); two providers to maintain eventually; quality/cost now depend on the
  user's chosen model.
- **Follow-ups this forces:** the `AIProvider` interface (E-13) and the Anthropic
  implementation via `@anthropic-ai/sdk`; secure local key storage; E-12's redaction +
  visible send-boundary as the mandatory gate before any provider call; a later local
  (Ollama-shaped) provider; and a distinct consent from telemetry (ADR-0010) — sending
  context to the AI is its own explicit, per-use boundary.

## Open questions this leaves

- Default model and effort settings for the assistant (tuned in E-13 against real
  snapshots; current candidates `claude-sonnet-5` / `claude-opus-5`).
- Local-provider specifics (runtime, model, hardware floor) — deferred to the follow-on.
- OQ-7 is **resolved** by this ADR; see the Open Questions register.
