# 25 — M3 Slice 4: Storage Inspectors (E-18)

- **Milestone:** [M3+ — Additive Integrations](../planning/07-milestones.md).
- **What it delivers:** A storage inspector panel for **AsyncStorage** and **MMKV** — the
  two most-used JS-side key-value stores in RN. List keys, preview values, search,
  delete. The shared shape (key → JSON-serializable value) means one UI fits both.
- **Why this slice next:** the data lives in JS land (just like the component tree),
  so the wiring reuses the `evaluateOnTarget` seam from E-17. No new infra. SQLite
  is a bigger lift (different transport, different schema) — deferred to a follow-on.
- **Why not SQLite in v1:** SQLite databases live in the simulator's
  `NSDocumentDirectory` — the path is reachable via the filesystem, but the SQL layer
  is a separate concern. A real SQLite inspector needs (a) `find` the db file via
  the iOS app's documents dir, (b) ship a small SQL runner, (c) handle schema
  introspection. That's a separate Epic. AsyncStorage + MMKV cover the same
  developer intent (peek at app state) for the majority of RN apps.

> Sizes: **S ≤ ½ day · M 1–2 days · L 3–5 days**. `core` stays Electron-free.

---

## Goal

A single Storage section in the renderer with a **backend selector** (AsyncStorage |
MMKV). Pick a backend → "Refresh" → list of keys with value previews → click a key
to see the full value + a delete button.

## Design contract

```
// core (pure, Electron-free) — given a CDP-sendable, the result is a typed
// snapshot. The actual JS expressions shipped to the app are tiny inlined
// IIFEs that walk the live modules.
type StorageBackend = 'async-storage' | 'mmkv';

interface StorageKey {
  readonly backend: StorageBackend;
  readonly key: string;
  /** A short preview of the value, JSON-stringified, capped at ~120 chars. */
  readonly preview: string;
}
interface StorageFull {
  readonly backend: StorageBackend;
  readonly key: string;
  /** The full value, JSON-stringified. */
  readonly value: string;
  readonly kind: 'string' | 'number' | 'boolean' | 'object' | 'null' | 'unknown';
}

type StorageSnapshot =
  | { readonly ok: true; readonly keys: readonly StorageKey[] }
  | { readonly ok: false; readonly kind: 'not_connected' | 'no_module' | 'timeout' | 'cdp_error' | 'remote_exception'; readonly message?: string };

// core/protocol/storage/expressions.ts — the JS expressions shipped to the app
export const ASYNC_STORAGE_KEYS_EXPRESSION = `(() => {
  const mod = globalThis.__RN_DEVTOOLS_GLOBAL_HOOK__?.ReactNativeApplicationContext
    ? null : null; // dev only — actual module name injected per app
  // (real expression is in expressions.ts — see the file)
})()`;

// desktop (main) wiring
ipc channels:
  query:storage.list   { backend: 'async-storage' | 'mmkv' } → StorageSnapshot
  query:storage.get    { backend, key } → { ok: true, value: string } | { ok: false, ... }
  command:storage.delete { backend, key } → { ok: true } | { ok: false, ... }
```

**Why "click time" + typed errors, not live:** storage is large; a live update
would flood the renderer. The user clicks Refresh; the previous snapshot stays
visible until the next click. Same posture as the component tree (E-17).

**Why the JS expressions are in `core/protocol/storage/expressions.ts`:** they
are part of the contract (the test can run them against a mocked CDP), and
they're the only piece of the inspector that needs to be RN-aware. The desktop
wiring is a thin transport.

## Tasks

| # | Task | Size | Depends | Notes |
|---|------|------|---------|-------|
| T-18.1 | `core/protocol/storage/expressions.ts` — JS expressions for AsyncStorage.getAllKeys / MMKV.getAllKeys; `safeStringify` (reuse the E-17 one) | S | E-17 (`Runtime.evaluate` seam) | Defensive: handle the case where the module isn't installed (e.g. an app that only uses MMKV) |
| T-18.2 | `core/protocol/storage/inspect.ts` — `inspectStorage(cdp, backend, options)` typed wrapper, mirrors the component tree's pattern | M | T-18.1 | The hard part: detecting "no module installed" vs "module installed, empty store" |
| T-18.3 | `desktop/main/storage-controller.ts` — owns the `evaluateOnTarget` calls, registers the IPC channels, mirrors `component-tree-controller` | M | T-18.2 | Pull-only on click |
| T-18.4 | Renderer: `StorageSection` — backend selector, Refresh, virtualized key list with previews, click-to-expand, delete button, search box | L | T-18.3 | Reuses the unified-log virtualization pattern |
| T-18.5 | Tests: expression-level tests (mock CDP), controller IPC tests, renderer search/filter (helper) | M | T-18.1–4 | The E-18 canary: an `async-storage` snapshot on a fake CDP returns the expected `StorageSnapshot` shape |

## Definition of Done — E-18

- Click "Refresh" with a backend selected → a list of keys + value previews appears.
- Click a key → full value JSON-stringified + a "Delete" button.
- Search filters the visible list (substring on key or value).
- The renderer shows a typed "no module installed" / "no key found" / "timeout" /
  "CDP error" message — never crashes.
- A delete removes the key from the live store; the next Refresh reflects it.
- `core` coverage gate still holds.

## Explicitly out of scope (deferred)

- **SQLite inspector.** A separate Epic: filesystem-based, with its own schema
  introspection. Trigger: design-partner asks for it.
- **Live auto-refresh.** Click time only, same as the component tree.
- **Multi-store management.** "Add a new MMKV instance with id `x`" is a real
  feature for power users, but v1 reads from the default instances only.
- **Editing values.** v1 is read + delete. Edit is a follow-on (mutation,
  re-render).
- **Encryption-aware displays.** MMKV supports encryption; v1 reads the decrypted
  value via the module's API, no special handling.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| The app doesn't have AsyncStorage / MMKV installed (a fresh RN template) | The expression tries `require('@react-native-async-storage/async-storage')`; on failure it returns `{ ok: false, kind: 'no_module' }`. The UI shows a clear message. |
| A large store (10k+ keys) freezes the renderer | The list is virtualized (E-11 pattern). The snapshot is bounded to N keys (default 1000) with a typed "too-many" warning |
| The JS module API differs across versions (AsyncStorage v1 vs v2, MMKV v2 vs v3) | The expression uses the most common API surface; if the call returns something unexpected, the walker returns `kind: 'unknown'` and the UI shows a generic message |
| A delete on a non-existent key is reported as success (some stores return false, some throw) | The expression normalizes the result; the IPC returns `ok: true` iff the key was actually removed |
| A value is a huge JSON blob (10MB) | The full-value getter truncates at 256 KB and returns a typed "too-large" reason (same pattern as the E-16 body fetcher) |

## Why this slice — and what comes after

The M3+ backlog, in build order: E-15 (export, done), E-16 (network, done),
E-17 (component tree, done), E-18 (storage, this), E-19 (performance),
E-20 (navigation), E-21 (release). Same pattern as before: pure `core` piece +
thin IPC + renderer surface, zero core changes. After E-18: E-19 (perf, which
needs CDP `Performance` domain), then E-20 (navigation via the in-app bridge),
then E-21 (release — the only slice that needs work outside the
core/desktop/renderer triumvirate).
