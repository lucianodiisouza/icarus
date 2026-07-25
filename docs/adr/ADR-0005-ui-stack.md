# ADR-0005 — UI stack: React + Vite + Zustand

- **Status:** Proposed
- **Date:** 2026-07-25
- **Deciders:** Staff Engineer / TPM
- **Related:** G-8 (fast inner loop), ADR-0003 (TypeScript), ADR-0006 (state over IPC)

## Context

The renderer is a data-dense, real-time debugging UI: streaming logs, trees, tables,
timelines. We need a component model, a fast dev server with HMR, and a state
management approach for renderer-local UI state (distinct from the authoritative
`DebugContextStore` in Main).

## Options considered

### UI framework
- **React** — largest ecosystem, and the team's domain _is_ React (RN devs). Building
  an RN tool in React keeps us fluent in our users' mental model. **Chosen.**
- **Svelte / SolidJS** — leaner/faster, but smaller ecosystem for the dense data
  components (virtualized tables/trees) we'll need, and less alignment with our RN
  audience/contributors.

### Bundler / dev server
- **Vite** — fast HMR, first-class TS, simple config; strong Electron-renderer
  integration via community plugins. **Chosen** (directly serves G-8).
- **Webpack** — mature but slower inner loop; more config.

### Renderer state management
- **Zustand** — tiny, unopinionated, hook-based; great for a store that mirrors
  snapshots/deltas streamed from Main; minimal boilerplate. **Chosen.**
- **Redux Toolkit** — powerful and structured but heavier; its ceremony isn't
  justified when the _authoritative_ state lives in Main and the renderer mostly
  mirrors it.
- **React Context only** — fine for tiny apps; re-render behavior and ergonomics don't
  scale to high-frequency debug streams.

## Decision

**React + Vite + Zustand** for the renderer, with heavy use of virtualization for
data-dense views (adopted per-view as needed). Component styling approach is left to
the first UI Epic (see Open Question) rather than forced here.

## Rationale

Every choice optimizes for (a) our audience/contributors already thinking in React,
and (b) the fast inner loop (G-8) that an ambitious multi-feature product needs to
survive. Zustand fits the architecture precisely: Main holds authoritative state
(ADR-0006), and the renderer keeps a light mirror plus UI-only state — Redux's
machinery would be over-engineering for that shape.

## Consequences

- Positive: fast HMR, familiar stack, low state boilerplate, easy to hire/onboard.
- Negative / accepted: React's re-render model requires care under high-frequency
  streams — mitigated by virtualization and by batching deltas at the IPC layer
  (TR-6).
- Follow-up: choose a styling system and a component/virtualization library in the
  first UI Epic, recorded as a follow-up ADR.

## Open questions this leaves

- OQ-12: styling system (CSS Modules vs. Tailwind vs. vanilla-extract) and component
  library — decided when the first real view is built, not before.
