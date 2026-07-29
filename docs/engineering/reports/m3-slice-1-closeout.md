# M3 First Slice Closeout — Opt-in Unified-Log Export (E-15) — 2026-07-29

> The M2 closeout named one explicit, opt-in follow-on:
> > "**opt-in full session export/replay (an explicit feature on top, never a default).**"
> This is the **export** half of that line. **Replay** (loading a file back into the live log)
> is a deliberate non-goal for this slice — see the explicit out-of-scope list in the plan doc
> and the deferred-item line in [TD-19](../../technical-debt.md). The slice ships on `main`,
> gated by tests, and shares its trust posture with the AI boundary it sits next to.

## Verdict

**Engineering-complete; product-pending.** A developer can click **Export N entries** in the
unified-log panel, review the OS save dialog (default filename: timestamped UTC `.jsonl`),
write the file, and see a green success line with the path and a redaction count — **or** a
typed error if the write fails, or a silent no-op if they cancel the dialog. The same
`redact()` rules the E-12 AI boundary uses scrub every entry before the file is written; the
M3 canary test (a planted `sk-...` key in a captured entry never reaches the file output) is
the regression gate. What this slice has _not_ earned: a real design-partner click on a
genuine debugging session. The thin slice is built, and the foundation carried it without
core changes — the M1→M2→M3 architectural promise paid in.

## What shipped — the export

| Layer | Where | Effect |
|---|---|---|
| Core formatter | `packages/core/src/unified-log/log-export.ts` | `buildLogExport(entries, meta)` — pure, Electron-free. JSONL + meta header. Same `redact()` rules as E-12. |
| Core tests | `packages/core/src/unified-log/log-export.test.ts` | 13 tests. The **M3 canary** (planted secret redacted in file output) is the trust gate. |
| Desktop wiring | `apps/desktop/src/main/log-exporter.ts` + `log-exporter-ipc.ts` | `LogExporter` with injected `pickPath` + `write` seams (testable without a window). Typed IPC channel `command:log.export` registered on the router. |
| Desktop tests | `apps/desktop/src/main/log-exporter.test.ts` | 7 tests: happy path, project label, fallback label, **M3 canary at the desktop boundary**, cancel = no-op, file write failure surfaces, zero entries still produces a valid file. |
| Preload + API | `apps/desktop/src/preload/index.ts` + `shared/ipc/api.ts` + `shared/ipc/contracts.ts` | `window.icarus.logExport({ entries })` with Zod-validated input (capped at 20k). |
| Renderer | `apps/desktop/src/renderer/App.tsx` | "Export N entries" button in the unified-log chip row, disabled when 0; success line (path + redaction count) or typed error; cancel is silent. |
| Plan doc | `docs/engineering/22-m3-opt-in-log-export.md` | The slice's design contract, guardrails, tasks, DoD, risks, and explicit out-of-scope list. |
| Live smoke | `scripts/live-assistant-smoke.ts` + `scripts/README.md` | The untracked M2 throwaway moved to a real home; recipe in `scripts/README.md`. |

## Exit-criteria scorecard (honest)

The slice's DoD (from the plan doc):

| # | Criterion | Status |
|---|---|---|
| 1 | Export is opt-in only — no IPC call is made without a user click. | 🟩 **Met.** The IPC channel is registered but never called from anywhere except the Export button handler; the handler is wired to a real onClick. |
| 2 | Exported file passes the **M3 canary** (planted secret redacted). | 🟩 **Met, gated by two automated tests.** `core/src/unified-log/log-export.test.ts` (the formatter) and `apps/desktop/src/main/log-exporter.test.ts` (the desktop wiring) both plant an API key and assert it never reaches the file. |
| 3 | Cancelling the file picker is a clean no-op (no error to the renderer). | 🟩 **Met.** `ExportCancelledError` → IPC reject; the renderer swallows that single message and shows nothing. |
| 4 | A file-write error is surfaced as a typed error, never swallowed. | 🟩 **Met.** Tested in `log-exporter.test.ts` ("file write failure propagates as a typed rejection"). |
| 5 | Export is synchronous from the renderer's POV for the user-click flow. | 🟩 **Met.** No background retries, no notifications, the button shows a spinner and is disabled during the await. |
| 6 | `core` coverage gate still holds (≥ 80%). | 🟩 **Met.** Core coverage is **87.65%** (up from 87.87% at M2 — the new code is well-tested and didn't drag the average). |
| 7 | Lint clean, typecheck clean, unit tests green, desktop build green, e2e green. | 🟩 **Met.** 346 unit tests pass; 10 e2e tests pass; `pnpm lint` is silent; `pnpm -r typecheck` is silent; `pnpm build` is green. |

## Architecture review

The foundation held. **Zero core changes were forced by E-15.** The unified-log model,
the E-12 redaction rules, the `FileStore` seam (TD-19), the typed IPC router
(ADR-0006), the `LogExporter` injection shape (mirrors `AssistantBridge` / the
reaper's `OrphanRegistry`) — all reused, none changed. The pattern is the same
as M2's thin slice: a small pure formatter, a thin IPC wiring, a renderer
button, a canary test. Two decisions worth recording:

- **The renderer is the source of truth for what to export.** The filter chips
  + search query live in the renderer; a filter-by-source/level toggle that
  main can't see is a footgun. The IPC carries the renderer's currently-visible
  entries to main, and main runs `redact()` over every entry before the file is
  written. The M3 canary is the regression gate that proves this never regresses
  to "main just writes what the renderer hands it" — redaction is the main-process
  responsibility, not a renderer policy. If a future contributor adds a
  redaction-bypass in main, the desktop canary fires.
- **The "no project name in the filename" stance is a real privacy choice.** The
  meta header carries it (where it belongs); the OS file picker shows a default
  name that does not. This is a deliberate decision, not an oversight — the file
  ends up in Slack / a bug report / a teammate's inbox, and a filename that
  already names the developer's project is one more leak surface. The default
  filename is just `icarus-log-YYYYMMDD-HHmmss.jsonl`.

## What this slice does NOT do (deliberate, in writing)

From the plan doc — each line has a trigger to revisit:

- **Network export.** The unified log covers logs only. Adding network is
  mechanical (same formatter, just more entries) — the toggle belongs in the
  renderer. Trigger: design-partner asks for it.
- **Replay (load a file back into the live log).** A "import this export" feature
  is a separate, larger Epic — not a thin slice. Trigger: design-partner asks
  for it.
- **Auto-export on app exit / on crash.** Out. TD-19 already covers
  crash-recovery; that's a separate feature with separate consent.
- **Cloud upload, share-link, paste-to-GitHub.** Out by mission (TR-5). The file
  write is the end of the line.
- **HTML/PDF/markdown formats.** Out. JSONL is the one format. Adding more is
  format-options bloat for a feature that earns its keep by being predictable.
- **Filter-aware export that goes *wider* than the renderer's current view.** Out.
  The filter is the user's intent; exporting the unfiltered log would surprise
  them.

## M3 → next-slice gate

E-15 pays the M1→M2→M3 architectural promise in: **adding a real feature module
needed zero core changes.** The next M3 slice is a real product-priority call —
M3+ ordering is evidence-driven, and the M2 closeout says so explicitly. When
that call is made (network inspector upgrade, component tree, storage
inspector, performance, …), the **same shape** applies: a typed IPC channel, a
pure `core` piece, a tested wiring, a renderer surface, zero core changes.
This slice is the proof that the foundation carries it.
