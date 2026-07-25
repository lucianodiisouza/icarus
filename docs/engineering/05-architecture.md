# 05 — Architecture Proposal

> **Status:** Proposal for the foundation (M0–M2). This will be revised at every Epic
> retrospective. Specific technology choices are justified in the [ADRs](../adr/README.md);
> this document is about _shape_, _boundaries_, and _data flow_.

## Guiding constraints (from Vision & Goals)

1. **Context is the product** → there must be one shared, structured, observable
   "debug context" model. (G-3)
2. **Everything is, underneath, "manage a process or speak a protocol"** → these are
   core primitives, not per-feature reinventions. (G-2)
3. **Each of the 18 future integrations is plugin-shaped** → a stable internal module
   contract so features are built/tested/shipped independently. (G-1)
4. **Shell-agnostic core** → OS/process/protocol logic must not depend on Electron, so
   a future Rust/Tauri move (TR-7) doesn't require a rewrite.
5. **Secure by construction** → the process boundary is a validated trust boundary.
   (TR-3, [ADR-0004](../adr/ADR-0004-security-model.md))

## The 10,000-ft view

Icarus is an Electron app with three logical tiers, kept deliberately separate:

```
┌──────────────────────────────────────────────────────────────────┐
│  RENDERER  (untrusted-by-default, no Node)                         │
│  React + TypeScript UI. Reads debug-context snapshots,             │
│  dispatches intents. Knows nothing about OS/processes/protocols.   │
└───────────────▲───────────────────────────────┬──────────────────┘
                │  typed, validated IPC (preload bridge)              │
                │  (queries, commands, event streams)                 │
┌───────────────┴───────────────────────────────▼──────────────────┐
│  MAIN  (Electron main process — thin orchestrator)                 │
│  - Owns windows, app lifecycle, secure IPC router                  │
│  - Hosts the CORE and the FEATURE MODULES                          │
│                                                                    │
│  ┌────────────────────  CORE (shell-agnostic)  ─────────────────┐  │
│  │  ProcessManager · DeviceRegistry · DebugContextStore ·       │  │
│  │  ProtocolClients (CDP…) · EventBus · Logger · Config         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌───────────  FEATURE MODULES (plugin-shaped)  ───────────────┐   │
│  │  metro · logs · devices · network · component-tree · …       │   │
│  │  (NONE built yet — this is the slot they plug into)          │   │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ spawns / speaks to
        ┌──────────────────────┼───────────────────────────┐
        ▼                      ▼                           ▼
  Metro (Node CLI)     adb / xcrun simctl / emulators   Hermes via CDP
                                                        (Metro inspector proxy)
```

## Tier responsibilities

### Renderer (UI)
- Pure presentation + interaction. React + TypeScript.
- **Holds no privileged capability.** It cannot spawn a process or open a socket.
- Talks to Main only through a **typed IPC facade** exposed by a `preload` script with
  context isolation on and `nodeIntegration` off.
- Subscribes to **debug-context snapshots / deltas** and renders them; sends **intents**
  ("start Metro", "clear logs") that Main validates and executes.

### Main (orchestrator + host)
- Thin. Its job is to wire things, own the app lifecycle, and enforce the IPC trust
  boundary — **not** to contain business logic directly.
- Hosts the Core and registers Feature Modules.
- The **IPC Router** is an allowlist: every channel has a schema (validated with a
  runtime validator, e.g. Zod), a direction, and a handler. Anything not registered is
  rejected. (See [ADR-0004](../adr/ADR-0004-security-model.md).)

### Core (the shell-agnostic heart)
The pieces every feature reuses. **No Electron imports allowed here** (enforced by lint
rule) so it stays portable (TR-7).

| Core module | Responsibility | Notes |
|-------------|----------------|-------|
| `ProcessManager` | Spawn/observe/kill child processes with lifecycle contract, health, log capture, guaranteed teardown | Highest-risk primitive (TR-2). OS-specific teardown behind one interface. |
| `DeviceRegistry` | Discover & track simulators/emulators/physical devices | Wraps `adb`, `simctl` behind a uniform `Device` type |
| `DebugContextStore` | The single structured, observable model of "what's happening" | The product's moat (G-3). Feature modules write typed slices; UI & AI read snapshots |
| `ProtocolClients` | CDP client(s) and future protocol adapters | Starts empty; CDP added via the M1 spike (TR-1) |
| `EventBus` | In-process pub/sub between core & modules | Decouples producers from consumers; supports streaming/backpressure (TR-6) |
| `Logger` / `Telemetry` | Structured logging of Icarus itself | Observability of our own plumbing (principle 4) |
| `Config` | User/project/app configuration & environment "doctor" | Detects adb/xcrun/node/watchman (TR-4) |

### Feature Modules (the plugin slot — empty today)
Every future integration implements one contract:

```ts
interface FeatureModule {
  id: string;                       // "metro", "logs", "network", …
  init(ctx: ModuleContext): Promise<void>;   // gets Core handles
  dispose(): Promise<void>;                  // clean teardown
  // declares its IPC channels, its slice of DebugContextStore,
  // and the EventBus topics it publishes/subscribes to.
}
```
`ModuleContext` hands the module _scoped_ access to Core (a process handle factory, a
typed store slice, an event-bus namespace, a logger). A module **cannot** reach outside
its declared surface. This is what makes G-1 real: adding "network inspection" later is
"write a module," not "touch the core."

## Data flow (concrete example, using the future Logs feature)

1. UI dispatches intent `metro.start(projectPath)` → preload → IPC Router validates →
   routes to the `metro` module.
2. `metro` module asks `ProcessManager` to spawn Metro; gets a process handle with a
   log stream.
3. Log lines flow onto the `EventBus`; the `logs` module normalizes them and writes a
   typed slice into `DebugContextStore` (batched/windowed — TR-6).
4. `DebugContextStore` emits a delta; the IPC layer streams it to the Renderer.
5. UI renders the log view. Later, the **AI assistant** reads a `DebugContextStore`
   snapshot to answer "summarize these errors" — no copy-paste (G-6).

Note how the AI assistant is _just another reader_ of the same model. That is the
whole point of centralizing context.

## Key architectural decisions (each has an ADR)

| Decision | Choice (proposed) | ADR |
|----------|-------------------|-----|
| Desktop shell | Electron (for now) | [ADR-0002](../adr/ADR-0002-desktop-shell-electron-vs-tauri.md) |
| Language | TypeScript everywhere | [ADR-0003](../adr/ADR-0003-language-typescript.md) |
| Repo layout | pnpm-workspace monorepo | [ADR-0001](../adr/ADR-0001-monorepo-pnpm-workspaces.md) |
| Security / IPC trust boundary | Context isolation + validated allowlist IPC | [ADR-0004](../adr/ADR-0004-security-model.md) |
| UI stack | React + Vite + a lightweight store | [ADR-0005](../adr/ADR-0005-ui-stack.md) |
| Renderer↔Main state | Snapshot/delta over typed IPC | [ADR-0006](../adr/ADR-0006-ipc-and-state.md) |
| Feature modularity | In-process plugin-shaped modules | [ADR-0007](../adr/ADR-0007-feature-module-architecture.md) |
| Debugger protocol | CDP via Metro inspector proxy | [ADR-0008](../adr/ADR-0008-debugger-protocol-cdp.md) |

## What we are deliberately NOT deciding yet

- **Process isolation for feature modules** (in-process vs. separate worker/process
  per module). We start in-process for velocity; if a module misbehaves or a native
  binding threatens stability, we revisit. **Open Question OQ-8.**
- **Whether the AI runs locally, via API, or BYO-key.** Architecture keeps the AI as a
  reader of `DebugContextStore` so this is swappable. **Open Question OQ-7.**
- **Persistence.** Whether debug context is ever persisted to disk (session replay) is
  deferred. The store is in-memory first. **Open Question OQ-9.**

## Why this shape (rationale summary)

- A **thin Main + shell-agnostic Core** hedges the biggest tech bet (Electron, TR-7)
  and keeps the risky, high-value logic testable without spinning up Electron.
- A **single DebugContextStore** is the one non-negotiable structural commitment,
  because it is what turns 18 disconnected tools into one product with an AI layer.
- **Plugin-shaped modules** directly encode Product Goal G-1 into the code, so the
  ambition is additive rather than a series of rewrites.
