# Architecture Decision Records (ADRs)

An ADR captures **one architecturally significant decision**: its context, the options
weighed, the decision, and the consequences we accept. ADRs are immutable once
`Accepted` — to change a decision, write a new ADR that supersedes the old one and
update the old one's status to `Superseded by ADR-XXXX`.

We follow a lightweight variant of the Nygard ADR format.

## Statuses

`Proposed` → `Accepted` → (`Deprecated` | `Superseded`)

In Phase 0, ADRs are **Proposed** until the M0 plan is signed off, at which point the
foundational ones become **Accepted**. ADR-0008 was TR-1-dependent and is now
**Accepted** — the M0 CDP spike validated it live (see its
[report](../engineering/reports/cdp-spike-report.md)); we did not fake certainty, we
tested first.

## Index

| ADR | Title | Status | Notes |
|-----|-------|--------|-------|
| [0001](ADR-0001-monorepo-pnpm-workspaces.md) | Monorepo with pnpm workspaces | Proposed | |
| [0002](ADR-0002-desktop-shell-electron-vs-tauri.md) | Desktop shell: Electron over Tauri | Proposed | Revisit if perf/footprint blocks adoption (TR-7) |
| [0003](ADR-0003-language-typescript.md) | TypeScript everywhere | Proposed | |
| [0004](ADR-0004-security-model.md) | Electron security & IPC trust boundary | Proposed | Gates IPC/process Epics |
| [0005](ADR-0005-ui-stack.md) | UI stack: React + Vite + Zustand | Proposed | |
| [0006](ADR-0006-ipc-and-state.md) | Renderer↔Main state via snapshot/delta IPC | Proposed | |
| [0007](ADR-0007-feature-module-architecture.md) | In-process plugin-shaped feature modules | Proposed | |
| [0008](ADR-0008-debugger-protocol-cdp.md) | Debugger protocol: Origin-authed CDP via Metro inspector (hybrid) | **Accepted** (validated by M0 spike) | [Spike report](../engineering/reports/cdp-spike-report.md) |
| [0009](ADR-0009-defer-abstractions-rule-of-three.md) | Defer streaming/module-SDK abstractions (rule of three) | Proposed | From [Review #1](../engineering/17-architecture-review-2026-07-25.md) |

## Template

New ADRs copy [`_TEMPLATE.md`](_TEMPLATE.md).
