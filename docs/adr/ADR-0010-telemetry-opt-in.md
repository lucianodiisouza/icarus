# ADR-0010 — Telemetry: opt-in, anonymous, never debug data

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** Staff Engineer / TPM (product decision, OQ-6)
- **Related:** OQ-6 (the open question this closes), TR-5 (AI/data leakage), NG-8
  (footprint non-goal), Success Metrics (Doc 03 — the "instrumentation caveat"),
  the mission's "offline-first whenever possible" principle.

## Context

Icarus is a debugging tool: the data it handles — source paths, console logs, network
bodies, possibly tokens and PII — is exactly the data a developer least wants leaving
their machine. At the same time, the Success Metrics doc (Doc 03) notes that every usage
metric is gated on a telemetry decision (OQ-6): until it's resolved, adoption signal is
qualitative (interviews) only. We must decide **whether Icarus collects anything, what,
and how it's consented** — before any usage metric is wired and before the M2 AI epic,
which introduces its own "what leaves the machine" surface (E-12/TR-5).

Constraints: privacy-first is a product value; the docs already take an anti-telemetry
stance ("we do not collect telemetry by default"); the tool must be trustworthy enough
that a developer will point it at their real, sensitive app.

## Options considered

### Option A — No telemetry at all, ever
- **Pros:** Maximally private; simplest trust story ("we collect nothing"); zero
  data-handling surface to audit or get wrong.
- **Cons:** Automated Success Metrics stay impossible **forever** — adoption and
  friction signal is interviews-only, which doesn't scale past the first design partners
  and can't catch silent drop-off. Removes a legitimate feedback loop for improving the
  tool.

### Option B — Opt-in, anonymous, no debug data *(chosen)*
- Telemetry is **OFF by default**. The user explicitly enables it. When enabled, only
  **anonymous engineering-health events** are sent — e.g. crash-free-session flag,
  coarse feature-usage counts, app version, OS. **Never** debug content: no source, no
  log lines, no network bodies, no file paths, no project names, no PII. A transparent,
  in-repo "what we collect" manifest is the source of truth, and the user can inspect
  and revoke at any time.
- **Pros:** Consistent with privacy-first and offline-first; unblocks Success Metrics
  for the subset who consent; the strict "no debug data" line is a bright, auditable
  rule; opt-in means the default install phones home to nobody.
- **Cons:** Consenting users are a self-selected, possibly biased sample; some
  engineering effort to build the consent surface, the event allow-list, and the
  "what we collect" manifest; a standing (small) data-handling responsibility.

### Option C — Opt-out (anonymous metrics on by default, user can disable)
- **Pros:** Best data coverage; catches drop-off the opt-in sample misses.
- **Cons:** Contradicts the documented privacy-first / anti-telemetry stance; for a tool
  handling this class of data, on-by-default collection is a trust liability that could
  itself deter adoption. Rejected.

## Decision

**Option B — opt-in, anonymous, never debug data.** Telemetry ships **disabled**; the
user turns it on with informed consent; enabled telemetry carries only anonymous
engineering-health events drawn from an explicit allow-list, and **never** any debug
content, source, logs, network data, paths, project names, or PII. A checked-in
"what we collect" manifest is authoritative and the consent UI links to it.

## Rationale

This is the only option consistent with "truth stays on the user's machine unless they
say otherwise," which is the trust posture a debugging tool needs (a developer must
believe Icarus won't exfiltrate their app). It still recovers a real, if partial,
adoption signal (beating Option A's interviews-only ceiling) without Option C's
on-by-default liability. The **bright line — telemetry and debug data are separate
systems that never mix** — is what makes the promise auditable rather than aspirational,
and it pre-establishes the discipline E-12 (the AI data boundary) will need for the same
class of data.

## Consequences

- **Positive:** Privacy-first is now a written, enforceable contract; Success Metrics can
  wire automated collection behind consent; the "no debug data in telemetry" rule is a
  clear invariant tests and reviews can check.
- **Negative / accepted:** Consenting-user sample bias; ongoing (small) responsibility to
  keep the allow-list and manifest honest; some build cost for the consent surface.
- **Follow-ups this forces:** a telemetry module with an event allow-list (not a
  free-form logger); a consent/settings surface (off by default); the checked-in
  "what we collect" manifest; and an M2 alignment point — E-12's "what gets sent to the
  AI" boundary is a **separate** consent from telemetry and must be presented as such.

## Open questions this leaves

- Which specific engineering-health events belong on the allow-list (decided when the
  telemetry module is built, against the Success Metrics list).
- Transport/endpoint and retention for consented events (a later infra decision; must
  itself collect nothing beyond the allow-listed payload).
- OQ-6 is **resolved** by this ADR; see the Open Questions register.
