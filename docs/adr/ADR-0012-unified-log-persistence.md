# ADR-0012 — Unified-log persistence: bounded, local-only, cleared on clean exit

- **Status:** Accepted
- **Date:** 2026-07-26
- **Deciders:** Staff Engineer / TPM (product decision, OQ-9)
- **Related:** OQ-9 (the open question this closes), TD-19 (the debt it pays down), TR-5
  (debug context can carry secrets/PII), ADR-0010 (privacy posture — truth stays on the
  user's machine), E-10 (the unified log), E-03s (the bounded snapshot ring it reuses),
  TD-11 (the reaper — a sibling "recover from a crash" mechanism), the mission principles
  "offline-first whenever possible" and "minimal memory footprint".

## Context

The unified log (E-10) is in-memory only: close or crash Icarus and the session's logs are
gone. OQ-9 asked whether debug context is ever persisted to disk (session replay). The pull
is real — a developer who just saw a crash wants those logs back when they reopen the tool —
but so is the tension: the log can contain exactly the data a developer least wants durably
written down (source paths, tokens, PII — TR-5). We must decide **whether, what, and how**
the unified log is persisted, consistent with the privacy posture ADR-0010 set (data stays
on the user's machine, minimized) and the ecosystem norm (browser devtools and Metro do
**not** keep console history across restarts).

## Options considered

### Option A — No persistence, ever (status quo)
- **Pros:** Zero durable footprint; nothing to leak; simplest.
- **Cons:** A crash loses all context — the worst moment to lose logs. No restart continuity.

### Option B — Full on-disk session history (append-only, unbounded/rotated)
- **Pros:** Complete session replay and export.
- **Cons:** A durable archive of sensitive data by default — the strongest TR-5 liability;
  unbounded growth (conflicts with the footprint non-goal); far past what "get my logs back
  after a crash" needs. Rejected as a default.

### Option C — Bounded local tail, cleared on clean exit *(chosen)*
- Persist only a **bounded recent tail** (the same recent-history window the renderer
  snapshot already keeps) to a single file under `userData`, written on a **debounced**
  cadence so a high-rate stream is bounded I/O. On a **clean exit** the file is **removed**,
  so a normal close leaves **no durable debug-log footprint**; only a **crash** (no cleanup
  runs) leaves the tail, which the next launch restores into the live log and then clears.
  The file is **local-only** — never transmitted; the E-12 boundary still gates any AI send.
- **Pros:** Recovers the one case that matters (crash) without becoming an archive; footprint
  is bounded by construction; matches the devtools norm (fresh console on a normal restart);
  smallest sensitive-data exposure that still delivers the value; symmetric with the reaper
  (TD-11 recovers crashed *processes*; this recovers crashed *log state*).
- **Cons:** No long-term history/export by default (a deliberate non-goal here); clean-exit
  clear is best-effort (an abrupt kill leaves the tail — which is exactly the recovery case).

## Decision

**Option C.** A bounded, debounced, local-only tail under `userData`, restored on launch and
**cleared on clean exit**. Implemented Electron-free (`UnifiedLogPersistence` over an injected
`FileStore`, ADR-0002); the desktop shell wires it to `whenReady` (load → replay → capture)
and to the clean-exit teardown (clear). AI never receives this file except through the
explicit E-12 send-boundary.

## Rationale

This is the only option that recovers the crash case — the moment logs are most valuable —
while honoring ADR-0010's "keep it on the machine and minimized" and the ecosystem norm that
debug consoles don't persist by default. Bounding to the existing snapshot window means no
new growth surface (footprint non-goal), and clearing on clean exit means the durable
footprint in the common path is **nothing**. Reusing the append-only ring (E-03s) and the
injected-store discipline (TD-11) keeps the mechanism tiny and fully unit-testable.

## Consequences

- **Positive:** A crash no longer loses the recent log; restart continuity for the case that
  matters; footprint stays bounded; a clean close leaves no debug-log artifact; the
  `FileStore`/persistence seam is now available for future persisted state.
- **Negative / accepted:** No full-session archive or export by default; clean-exit clear is
  best-effort under an abrupt kill; a crash does leave a bounded tail on disk until the next
  launch clears it (the intended trade for recovery).
- **Follow-ups this forces:** a user-facing "clear logs now" control (the `clear()` seam
  exists); if export/replay is ever wanted, it's an explicit, opt-in feature on top of this —
  not a default; a possible future opt-out for users who want zero persistence even across a
  crash.

## Open questions this leaves

- Retention/size of the tail beyond the current snapshot-matched default (tune with real use).
- Whether a full, opt-in session-export feature is worth building (deferred; not a default).
- OQ-9 is **resolved** by this ADR; see the Open Questions register.
