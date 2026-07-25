# 11 — Folder Structure

This is the **target layout for M0**. It encodes the architecture
([Doc 05](05-architecture.md)) and ADR-0001 (pnpm workspaces) into directories, so that
architectural boundaries are also filesystem/package boundaries. It will evolve; changes
go through review.

> Reminder: this describes where code _will_ live. No application code exists yet.

```
icarus/
├── docs/                        # ← you are here. Source of truth for planning.
│   ├── README.md
│   ├── planning/                # vision, goals, risks, milestones, epics, stories, tasks, open questions
│   ├── engineering/             # architecture, folder structure, standards, testing, ci/cd, release, tech-debt
│   └── adr/                     # architecture decision records
│
├── apps/
│   └── desktop/                 # the Electron application (the ONLY app for now)
│       ├── src/
│       │   ├── main/            # Electron MAIN: window/lifecycle, IPC router, module host
│       │   ├── preload/         # preload bridge — the narrow, typed renderer API (ADR-0004)
│       │   └── renderer/        # React UI (ADR-0005). NO Node, NO core-internal imports
│       ├── electron.vite.config.ts
│       └── package.json
│
├── packages/
│   ├── core/                    # SHELL-AGNOSTIC heart. NO electron import allowed (lint-enforced)
│   │   └── src/
│   │       ├── process/         # ProcessManager (G-2, TR-2)
│   │       ├── devices/         # DeviceRegistry
│   │       ├── context-store/   # DebugContextStore (G-3) — the product's moat
│   │       ├── protocol/        # ProtocolClients (CDP added after M1 spike)
│   │       ├── event-bus/
│   │       ├── logger/
│   │       └── config/          # incl. environment "doctor" (TR-4)
│   │
│   ├── ipc/                     # typed IPC contracts + validation (ADR-0006), shared by main & renderer
│   │
│   ├── module-sdk/              # FeatureModule + ModuleContext contract & conformance kit (ADR-0007)
│   │
│   ├── modules/                 # feature modules live here. EMPTY at M0 except the example.
│   │   └── example/             #   throwaway proof module (E-05) — deleted once real modules exist
│   │   # future: metro/ devices/ logs/ network/ component-tree/ storage/ ...
│   │
│   └── config/                  # shared dev config packages
│       ├── tsconfig-base/
│       ├── eslint-config/
│       └── prettier/
│
├── tooling/                     # repo scripts (soak tests, release helpers, doctor CLI wrappers)
├── .github/workflows/           # CI/CD (see Doc 15)
├── pnpm-workspace.yaml
├── package.json                 # root: workspace scripts only
├── tsconfig.json                # root references
└── README.md                    # points at docs/
```

## Rationale for the key choices

- **`apps/` vs `packages/`** — `apps/desktop` is a deployable; `packages/*` are
  libraries it composes. This keeps the deployable thin and pushes logic into testable,
  boundary-enforced packages (G-1).
- **`core` is its own package with an import ban** — the shell-agnostic hedge (TR-7,
  ADR-0002) is only real if it's a hard boundary. A separate package + lint rule makes
  "core accidentally imports Electron" a build failure, not a code-review maybe.
- **`ipc` and `module-sdk` are separate shared packages** — both are _contracts_ used by
  multiple sides (main, renderer, modules). Isolating them stops circular deps and makes
  the trust boundary (ADR-0004) and the module boundary (ADR-0007) explicit artifacts.
- **`modules/` starts almost empty** — this is the plug slot from the architecture. The
  `example` module exists only to prove the contract (E-05) and is removed once real
  modules land. Its presence at M0 is the living proof of G-1.
- **`renderer` may not import `core` internals** — enforced by lint; the renderer only
  ever speaks `ipc`. This preserves the process/trust boundary.

## Boundary rules (lint-enforced where possible)

1. `packages/core/**` must not import `electron` or anything renderer-specific.
2. `apps/desktop/src/renderer/**` must not import `packages/core/**` internals or Node
   built-ins — only `packages/ipc` (via preload) and UI deps.
3. Feature modules import only `module-sdk` and their own deps — never another module's
   internals, never `core` internals beyond what `ModuleContext` provides.
4. `ipc` and `module-sdk` are dependency-free of app/shell code (pure contracts).

## Open questions

- OQ-10: whether each real feature module becomes its own package or `modules/` groups
  them — decided when the first real module lands.
- OQ-12: where renderer styling/design-system code lives — decided in the first UI Epic.
