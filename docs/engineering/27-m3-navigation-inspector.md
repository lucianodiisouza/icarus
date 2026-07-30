# 27 — M3 Slice 6: Navigation Inspector (E-20)

- **Milestone:** [M3+ — Additive Integrations](../planning/07-milestones.md).
- **What it delivers:** A **navigation inspector** panel that shows the running app's
  current navigation state — the active route, the route stack, and the params
  of each route. The minimum-viable version reads from `globalThis.__ICARUS_NAV_STATE__`
  if the app publishes it; if not, the panel shows a clear "no bridge" message with
  a copy-paste snippet the user can drop into their app.

> Sizes: **S ≤ ½ day**. This is the smallest additive slice — the inspector is a
> one-line read; the bridge snippet is documentation.

---

## Goal

Click Refresh → the inspector reads the nav state from the app → renders a flat
"active route + history stack + params" view. The app-side cost is one line:
`globalThis.__ICARUS_NAV_STATE__ = JSON.parse(JSON.stringify(navigation.getState()))`.
That's the v1 surface; the rest (event subscriptions, route-change push) is a
follow-on.

## Why this shape

The full "live React Navigation inspector" is a multi-day epic (in-app bridge,
event subscriptions, push updates, route-change history). This slice ships the
**read-only, click-driven, user-installed-bridge** version — the foundation all
of that builds on. The user explicitly opts in to publishing the state; the
inspector never reaches into React's internals.

## Design contract

```
// core (pure, Electron-free)
type NavStateSnapshot = {
  readonly type: 'react-navigation';
  readonly index: number;
  readonly routeNames: readonly string[];
  readonly routes: readonly { readonly name: string; readonly key: string; readonly params?: Record<string, unknown> }[];
  readonly activeRouteName: string;
};

type NavSnapshot =
  | { readonly ok: true; readonly state: NavStateSnapshot }
  | { readonly ok: false; readonly kind: 'not_connected' | 'no_bridge' | 'invalid_format' | 'timeout' | 'cdp_error' | 'remote_exception'; readonly message?: string };

// desktop IPC
ipc channels:
  command:nav.snapshot  → NavSnapshot
```

The app-side bridge snippet (the user adds this in their app):

```js
// In your app's root component, once:
if (typeof globalThis !== 'undefined') {
  globalThis.__ICARUS_NAV_STATE__ = JSON.parse(
    JSON.stringify(navigationRef.getRootState()),
  );
}
```

Optional: re-publish on every nav state change:

```js
navigationRef.addListener('state', () => {
  globalThis.__ICARUS_NAV_STATE__ = JSON.parse(
    JSON.stringify(navigationRef.getRootState()),
  );
});
```

(The Icarus renderer can also show the inspector's last snapshot side-by-side
with the live "active route" once the listener is installed — out of scope
for v1.)

## Tasks

| # | Task | Size | Depends | Notes |
|---|------|------|---------|-------|
| T-20.1 | `core/react-tree/nav-probe.ts` — pure walker that turns a raw nav-state object into a typed `NavStateSnapshot` (defensive on shape) | S | E-17 walker | Tested with hand-built nav-state mocks |
| T-20.2 | `desktop/main/nav-controller.ts` — owns the `Runtime.evaluate` round-trip, registers the IPC channel | S | T-20.1 | Mirrors `component-tree-controller` (E-17) |
| T-20.3 | Renderer: `NavSection` — small panel: "active route" + history list + a "no bridge" message with a copy-paste snippet the user can drop into their app | S | T-20.2 | |
| T-20.4 | Tests: nav-probe walker, controller IPC, renderer card | S | T-20.1–3 | The E-20 canary: a hand-built nav state with 2 routes produces the right snapshot |

## Definition of Done — E-20

- Click Refresh → if the app has published the nav state, the panel renders the
  active route + history + params. If not, the panel shows a clear "no bridge"
  message with a copy-paste snippet.
- The "active route" is highlighted; the history stack is shown as a list
  (newest first).
- The user can copy the snippet to clipboard from the panel (single button).
- Defensive: a malformed `__ICARUS_NAV_STATE__` is reported as
  `kind: 'invalid_format'`, not a thrown error.

## Explicitly out of scope (deferred)

- **Live push updates.** The inspector is read-on-click for v1. Live updates need
  the app to publish on every state change AND the inspector to subscribe to
  the change. Trigger: design-partner asks for it.
- **Multiple navigators.** v1 reads the global bridge — single navigator.
  Multi-navigator support is a follow-on.
- **Other navigation libraries.** v1 assumes React Navigation v5/v6/v7. Expo
  Router / React Native Navigation have different APIs.
- **Editing the active route** (jump-to-route). Out by mission (NG-6).
- **In-app bridge packaging.** A real `npm install` package is the right shape
  for a polished version. v1: documented snippet.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| The user doesn't install the bridge → the panel shows "no bridge" forever | The panel's "no bridge" message includes a one-click copy-to-clipboard of the snippet |
| A circular ref in the nav state (unlikely but possible) | The probe runs `JSON.parse(JSON.stringify(...))` (the same trick the AI assistant uses for its bounded context), which strips functions and cycles; the result is JSON-serializable |

## Why this slice — and what comes after

The M3+ backlog, in build order: E-15, E-16, E-17, E-18, E-19 (done); E-20
(this); E-21 (release workflow). After E-20: E-21 — the unblocker for any
external user. E-21 is the only slice that needs work outside the
core/desktop/renderer triumvirate (signing, notarization, packaging).
