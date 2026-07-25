# 02 — Non-Goals

A non-goal is something we could plausibly be expected to do, but are **deliberately
choosing not to do** — now, or ever. Each states the reasoning so a future
contributor doesn't "fix" a decision that was intentional.

## Non-goals for the foreseeable future (scope discipline)

### NG-1 — We are not building any of the 18 integrations _yet_
Metro, RN DevTools, Hermes, ADB, simulators, network, component tree, storage
inspectors, performance, navigation, native logs, device management, build system:
**none are implemented in the current phase.** They define the ambition and constrain
the foundation, nothing more. Building the foundation correctly is the entire near-
term job.

### NG-2 — We are not writing a new debugger protocol or engine
We build **on top of** existing, official protocols — primarily Chrome DevTools
Protocol (CDP) as exposed by Hermes / React Native DevTools, and existing CLIs
(`adb`, `xcrun simctl`, Metro's CLI). We do not reimplement Hermes, a JS VM, or a
bespoke wire protocol. **Why:** that path is a multi-year effort orthogonal to our
value, and it would rot as the ecosystem moves.

### NG-3 — We are not replacing the developer's editor/IDE
Icarus is a debugging and runtime environment, not a code editor. We may _link into_
an editor (open a file at a line) but we do not compete with VS Code / Xcode / Android
Studio as an authoring surface. **Why:** unbounded scope; the editor market is
saturated and not where our differentiation lives.

### NG-4 — We are not building a CI runner or cloud device farm
No hosted builds, no remote device farms, no team dashboards in v1+. Icarus is a
**local, single-developer desktop tool** first. **Why:** these are large, separate
products with different infra, security, and business models. (Revisit only if the
[Success Metrics](03-success-metrics.md) prove the local tool has pull.)

### NG-5 — We do not support non-React-Native apps
No generic mobile debugging, no native-only (pure Swift/Kotlin) app support, no web
app debugging. The RN focus is the point. **Why:** focus is our only advantage
against larger generalist tools.

### NG-6 — The AI assistant is not an autonomous agent that ships code to prod
The assistant reasons over debug context and can _propose_ actions. It does not
independently modify the user's source, push commits, or take irreversible device
actions without explicit, per-action confirmation. **Why:** trust and safety (see
[Product Goal G-7](01-product-goals.md)); an assistant that breaks your app or repo
unprompted is a net negative.

### NG-7 — We are not committing to Windows/Linux feature-parity in early milestones
macOS is the primary target first (OQ-1). Windows/Linux are architecturally
_supported_ (Electron is cross-platform) but not guaranteed feature-parity while iOS
tooling (which is macOS-only anyway) matters most. **Why:** the RN + iOS developer is
macOS-bound; chasing parity early dilutes effort. We keep the code cross-platform-
clean so we don't _preclude_ it.

### NG-8 — We are not optimizing for extreme performance/footprint in the foundation
We accept Electron's footprint to move fast and stay in the Node ecosystem where
Metro/CDP/RN tooling lives (see [ADR-0002](../adr/ADR-0002-desktop-shell-electron-vs-tauri.md)).
Squeezing binary size / memory is explicitly a _later_ concern, gated on evidence.
**Why:** premature optimization would slow the foundation and might be moot if the
product doesn't find fit.

## How to challenge a non-goal

Non-goals are decisions, not dogma. To reverse one, open an ADR that references the
non-goal ID, states what changed, and gets review. Silent scope creep against these
is the failure mode this document exists to prevent.
