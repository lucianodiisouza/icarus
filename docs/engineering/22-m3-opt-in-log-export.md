# 22 — M3 First Slice: Opt-in Unified-Log Export (E-14 / TD-19 follow-on)

- **Milestone:** [M3+ — Additive Integrations](../planning/07-milestones.md).
- **Why this slice first:** M2 closed with the explicit deferred follow-on named:
  > "**opt-in full session export/replay (an explicit feature on top, never a default).**"
  ([M2 closeout](reports/m2-closeout.md)). It is the only M3+ item already green-lit
  in writing — no product-priority call needed, no design-partner input required. It
  is also the smallest additive feature that exercises the proven
  `UnifiedLogController` + `UnifiedLogPersistence` foundation end-to-end **without
  any core changes**, which is the M1→M2→M3 exit criterion (rule of three,
  ADR-0009).
- **What it delivers:** A user-clicked "Export logs" button in the unified-log panel
  that writes the **current** in-memory log (post-`includeLogs` toggle / filter
  chips) to a file the user picks. Default format: **JSON Lines** (one entry per
  line, easy to grep / pipe to `jq` / attach to a bug report). Redaction
  always-on, identical rules to the E-12 boundary (TR-5). Local-only; never
  transmitted. This is **session export**, not persistence — it has no relationship
  to the bounded on-disk tail in TD-19 other than sharing the same data model.
- **Why now is the right time:** The log is already captured, the persistence
  layer already owns the on-disk format, the redaction rules are already
  battle-tested (E-12 canary + grounding test). All this slice adds is: (a) a
  pure formatter, (b) a typed IPC channel, (c) a renderer button. Each piece is
  < 1 day and builds on existing seams.

> Sizes: **S ≤ ½ day · M 1–2 days · L 3–5 days**. `core` stays Electron-free
> (ADR-0002, lint-enforced). The file write is the only IO and lives in `apps/desktop`
> behind a `FileStore` seam (same shape as TD-19's persistence seam).

---

## Guardrails inherited

- **Local-only, user-initiated, opt-in.** No background export, no auto-attach to
  bug reports, no telemetry, no upload. The button is the only door.
- **Redaction is always-on, identical to the E-12 boundary.** Whatever the
  user sees in the exported file must be exactly what would reach the model — the
  same `redact()` rules, the same precision-first posture. The export can't be a
  back-channel around the redaction that protects AI sends.
- **No Electron in `core`.** The formatter and the redaction-pass are pure;
  the file write and `showSaveDialog` are desktop-side.
- **No new state on the controller.** Export reads a snapshot — the live log is
  unaffected (TR-6: never block the log pipe on IO).
- **UI is honest about scope.** The button shows entry count, the chosen path,
  and redaction totals (counts by category) **before** the file is written. The
  file write itself is awaited and surfaces errors.

---

## E-15 — Opt-in Unified-Log Export

### Goal

A one-click, opt-in export of the captured unified log to a user-chosen file
(JSON Lines, redacted, local-only), to support the workflow "paste into a bug
report / share with a teammate / archive a debugging session."

### Design contract

```
// core (pure, Electron-free)
formatLogExport(entries: readonly UnifiedLogEntry[], meta: ExportMeta): LogExport
//   → { text: string; report: RedactionReport; approxBytes: number }
//   writes one JSONL line per entry + a "# meta" header comment

// desktop (main)
ipcMain.handle(CHANNELS.LOG_EXPORT, input) → { path: string; count: number; report }
//   1. showSaveDialog (Electron) — user picks the path, can cancel
//   2. snapshot the live log (filtered by the toggles the user has set in the panel)
//   3. formatLogExport(entries, { capturedAtMs, sources, version })
//   4. fileStore.write(path, text)
//   5. return the path + count + redaction report
```

**JSONL format** (one entry per line, valid JSON each line, grep-friendly):

```
# Icarus unified-log export · 2026-07-29T18:56:00.000Z · 247 entries · redacted 3 (secrets×2, paths×1)
{"ts":1753818960000,"source":"cdp","level":"error","text":"TypeError: ..."}
{"ts":1753818960042,"source":"metro","level":"warn","text":"..."}
{"ts":1753818960103,"source":"native","level":"info","text":"..."}
```

**Why JSONL and not CSV/HTML/PDF:** dev-tools convention (`jq`, `grep`, `awk`),
trivially parseable, no quoting hell, and the redaction report + meta header are
comments so the file is still pure JSONL. CSV loses structure (no nested
metadata); HTML/PDF is a doc-format problem, not a debug-context problem.

### Tasks — E-15

| # | Task | Size | Depends | Notes |
|---|------|------|---------|-------|
| T-15.1 | `formatLogExport(entries, meta)` in `core/unified-log/export.ts` — pure, returns `{ text, report, approxBytes }`. Applies the **same** `redact()` rules as E-12 (call it directly from `redaction/`, don't re-implement) | S | E-10, E-12 (live) | Test on the planted-secret canary: a secret in a captured entry must be redacted in the export text |
| T-15.2 | `core` unit tests: format, empty log, large log (≥ 10k entries), mixed sources, redaction applied, meta header correct, line-delimiters stable on Windows (LF only — never CRLF in JSONL) | S | T-15.1 | The M3 equivalent of the E-12 canary, but for the export boundary |
| T-15.3 | `apps/desktop`: `LogExporter` class (in `src/main/log-exporter.ts`) — wires the typed IPC handler; inject `FileStore` (existing seam from TD-19) and a `pickSavePath` function (testable via a `() => Promise<string \| null>` seam that the renderer can't bypass) | M | T-15.1, E-12 (keyStore pattern) | The picker is `showSaveDialog` in prod, returns a fixture path in tests |
| T-15.4 | IPC contract in `shared/ipc/contracts.ts`: `CHANNELS.LOG_EXPORT` + input schema (`{ includeLogs, includeNetwork? — TBD, maxEntries? }`) + output schema (`{ path, count, report }`) | S | T-15.3 | Typed at the boundary; same Zod discipline as every other channel |
| T-15.5 | `LogExporter` tests: cancelled dialog → no write, no error; file write fails → typed error surfaced to renderer; snapshot reflects the user's filter toggles (logs: true/false, network: out-of-scope for now — `includeLogs` is the only switch in v1, network export is a follow-on) | M | T-15.3 | The desktop-side gate |
| T-15.6 | Renderer: `ExportButton` in the `UnifiedLogSection` panel — shows entry count, "Export…" button → triggers the IPC → renders success (path + counts) or error inline. **No default path**, no auto-export. Disabled when 0 entries. | M | T-15.4 | Honest UX: count → click → file picker → result |
| T-15.7 | `preload` exposes `window.icarus.logExport({ includeLogs })` and the return type | S | T-15.4 | Standard preload surface; no `ipcRenderer` exposure |

### Definition of Done — E-15

- The export is **opt-in only**: no IPC call is made without a user click.
- The exported file passes the **M3 canary** test: a planted secret in captured
  context is redacted in the file output (regression on the E-12 redaction
  rules).
- Cancelling the file picker is a clean no-op (no error to the renderer).
- A file-write error is surfaced as a typed error, never swallowed.
- The export is **synchronous from the renderer's POV** for the user-click
  flow: click → spinner → done-or-error. No background retries, no notifications.
- `core` coverage gate still holds (≥ 80%); new code is exercised by the M3
  canary + format tests.
- Lint clean; typecheck clean; `pnpm -r test` green; desktop `pnpm build` green.
- The throwaway live-smoke test (`smoke-assistant.local.test.ts`) is **moved**
  to `scripts/live-assistant-smoke.ts` with a proper shebang + a README recipe,
  not committed as a unit test (it isn't one — it needs a real key + network).

### Explicitly out of scope (deferred to a follow-on if/when needed)

- **Network export** (`includeNetwork` flag) — the panel exposes the toggle but
  the v1 export writes the log only. Adding network export is mechanical
  (same formatter, just more entries). Trigger: design-partner asks for it.
- **Filter-aware export** (export only what the search/filter shows) — the
  filter chips in the renderer apply to the snapshot taken at click time. The
  snapshot is the filtered view; this is implicit. Exporting **across all
  filters** (the unfiltered captured log) is a deliberate v1 non-goal — the
  filter is the user's intent.
- **Auto-export on app exit / on crash** — explicitly out. TD-19 already
  covers crash-recovery; that's a separate feature with separate consent.
- **Cloud upload, share-link, paste-to-GitHub** — out by mission (TR-5). The
  file write is the end of the line; what the user does with the file is on them.
- **HTML/PDF/markdown formats** — out. JSONL is the one format. Adding more is
  format-options bloat for a feature that earns its keep by being
  predictable.
- **Replay** — out. A "load a file and view it like the live log" feature is a
  separate, larger Epic. Export is one-way.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| User exports a log containing real secrets despite redaction | The **same** `redact()` rules as E-12, the **same** precision-first posture. The M3 canary test proves a planted secret is redacted in the file. We do not promise 100% — redaction is best-effort by design (the boundary report tells the user what was scrubbed). |
| File picker / write hangs in a way that blocks the UI | `showSaveDialog` is awaited; `fileStore.write` is awaited; the renderer's button shows a spinner and is disabled. No fire-and-forget. |
| Large log = huge file = write blocks Main for seconds | The log is already bounded (`UnifiedLogStream.snapshotCapacity = 2000`, plus persistence tail). Worst case is a few MB; the write is debounced via `setImmediate` chunking if needed. v1 is small enough that this is a non-issue. |
| Symlink / path traversal in user-chosen path | `showSaveDialog` returns a real OS path; no shell expansion. The `FileStore` writes bytes — no `eval`, no path interpolation. We don't follow symlinks; the write target is whatever the user picked. |
| Filename leaks project info (e.g. `my-secret-app-log.jsonl`) | Default name is `icarus-log-{ISO timestamp}.jsonl`. The user can rename in the picker. We do not append the project name or cwd to the suggested name (project name is already in the meta header, where it belongs). |

---

## Open Questions added by this slice

- **None.** The slice is small enough that the questions it raises are
  scope-shape calls, not design unknowns. The deferred items above each have a
  clear trigger, so they go on the backlog, not on the open-questions register.

## Why this slice — and what comes after

M3+ ordering is **evidence-driven** (M2 closeout). This slice is the one item
already named by writing, not by evidence — so it ships first. The next M3+
slice is a real product-priority call (network inspector upgrade? component
tree? storage inspector? performance?). Until that call is made, this is the
smallest shippable unit that keeps the foundation earning its keep.

When the next slice is chosen, the **same shape** applies: a typed IPC channel,
a pure `core` piece, a tested wiring, a renderer surface — and zero core
changes. That's the M1→M2→M3 architectural promise, and this slice pays it in.
