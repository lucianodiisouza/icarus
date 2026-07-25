# ADR-0007 — In-process, plugin-shaped feature modules

- **Status:** Proposed
- **Date:** 2026-07-25
- **Deciders:** Staff Engineer / TPM
- **Related:** G-1 (extensible foundation), TR-2 (process lifecycle), ADR-0006 (IPC/state), OQ-8

## Context

The vision lists ~18 integrations. Product Goal G-1 demands each be addable **without
touching core code**. We must decide the module boundary: what a module _is_, what it
can access, and — crucially — whether modules run **in-process** with Main or in
**isolated processes/workers**.

## Options considered

### Option A — In-process modules behind a `FeatureModule` contract *(chosen for now)*
Each module is a package implementing `init(ctx)/dispose()`, receiving a **scoped**
`ModuleContext` (process-handle factory, a typed `DebugContextStore` slice, an
EventBus namespace, a logger, a config view). It declares its IPC channels and store
slices.
- **Pros:** Fast to build and call; shares the Core directly; simplest to test; matches
  Electron's single-Main model. Boundaries are enforced by _scoped capabilities_ (a
  module only gets what `ModuleContext` hands it) rather than by OS process isolation.
- **Cons:** A misbehaving module (native binding crash, memory leak, event-loop
  hog) can destabilize Main. No hard fault isolation.

### Option B — Each module in its own process/worker
- **Pros:** Fault isolation; a crashing module doesn't take down the app; potential
  parallelism.
- **Cons:** Much heavier: cross-process serialization for every module interaction,
  complex lifecycle, harder debugging, slower delivery of the first modules. Premature
  when we have zero modules and are optimizing for foundation velocity.

### Option C — Dynamic third-party plugin system (load arbitrary external plugins)
- **Pros:** Ecosystem extensibility.
- **Cons:** Large security surface (arbitrary code in a privileged app — conflicts with
  ADR-0004); a product/community concern, not a foundation concern. Explicitly deferred.

## Decision

**Option A: in-process, plugin-shaped modules** with capability-scoped `ModuleContext`.
The contract is designed so that a **future move to process isolation (Option B) is a
change to how `ModuleContext` is wired, not a change to module code** — i.e. modules
should not assume they share memory with Core beyond the handles they're given.

## Rationale

G-1 is satisfied by the _contract and scoping_, not by process isolation — a module
already can't touch what `ModuleContext` doesn't grant it. Option B's fault isolation
is valuable but pays a heavy velocity and complexity tax now, for zero modules, against
our explicit foundation-velocity priority. By forbidding modules from reaching around
`ModuleContext`, we keep the door open to isolate later (per-module or for specific
risky modules like native storage inspectors) without rewriting them. That is the right
hedge for OQ-8.

## Consequences

- Positive: first modules ship fast; uniform, testable contract; capability scoping
  gives real boundaries; isolation remains a future option.
- Negative / accepted: no hard fault isolation yet — a bad module can crash Main.
  Mitigated by module-level error boundaries, timeouts, and the `dispose` contract; the
  `ProcessManager` already isolates the genuinely dangerous work (child processes) out
  of Main.
- Follow-up: define `ModuleContext` precisely in the first module Epic; add a
  contract-conformance test kit modules must pass.

## Open questions this leaves

- OQ-8: which (if any) modules warrant process isolation, and the trigger to introduce
  it (e.g. first native-binding-backed module, or first module-caused crash in the
  wild).
