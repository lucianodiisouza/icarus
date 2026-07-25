# 01 — Product Goals

Goals are ordered. Higher goals win when they conflict. Each goal states _why_ it is
a goal and how we'd know it's met. Goals here describe the **product's purpose**;
which milestone delivers them is in [Milestones](07-milestones.md).

## Foundational goals (the focus of the first milestones)

### G-1 — A correct, extensible foundation before features
**What:** A desktop application skeleton with a clean architecture where each future
integration (Metro, ADB, Network, …) is a well-isolated module behind a stable
internal contract.
**Why:** The stated first goal is _"build the project correctly."_ Every feature in
the vision depends on the same primitives: managed OS processes, a typed IPC layer,
a shared app-state model, and a plugin-shaped module boundary. Getting these wrong is
expensive to undo later.
**Signal:** A new "feature module" can be added with no changes to core code except
registration; adding a throwaway example module takes < 1 day for a new contributor.

### G-2 — Reliable process & device lifecycle management
**What:** Start/stop/observe long-lived child processes (Metro, emulators) and
one-shot commands (`adb`, `simctl`) with health, logs, and clean teardown.
**Why:** Almost every integration is, underneath, "manage a process or talk to a
device." This is the highest-leverage, highest-risk primitive.
**Signal:** Killing Icarus never leaves orphaned Metro/emulator processes; a crashed
child process is detected and surfaced, not silently lost.

### G-3 — A shared, structured "debug context" model
**What:** A typed, observable in-memory model that features write into (logs,
devices, later: network, component tree…) and that the UI and the AI assistant read
from.
**Why:** This model _is_ the moat (see [Vision](00-vision.md)). Designing its shape
early — even with only logs/devices in it — prevents every feature from inventing its
own incompatible state.
**Signal:** Two independent features (e.g. Logs and Device list) share one state
mechanism; the AI assistant can serialize a snapshot of context from one place.

## Product goals (the reason users show up — delivered after the foundation)

### G-4 — Run and observe a React Native app end to end
**What:** From inside Icarus: detect an RN project, start Metro, launch it on a
simulator/emulator, and see logs — without a terminal.
**Why:** This is the smallest slice that is _actually useful_ and exercises G-1..G-3
for real. It is the first "why would I open this?" answer.
**Signal:** A developer can go from "open Icarus" to "app running on a device with
live logs" in one flow.

### G-5 — Unify logs into one searchable, filterable stream
**What:** Metro logs, native logs (logcat / iOS system log), and app console output
in one place with filtering and search.
**Why:** Logs are the most universal debugging surface and the cheapest high-value
win once G-2 exists.
**Signal:** A developer stops keeping a separate `adb logcat` terminal open.

### G-6 — An AI assistant grounded in real debug context
**What:** An assistant that can read the shared debug-context model and help
interpret it ("summarize these errors", "what changed before this crash?").
**Why:** This is the differentiator and the vision's headline. It is deliberately
sequenced _after_ there is context worth reasoning over.
**Signal:** The assistant answers a question using data the developer did not have to
paste in manually.

## Cross-cutting goals (apply to everything, always)

### G-7 — Trustworthy by default
Every action that touches a device or the user's app is observable and, when
destructive, confirmed. No silent state mutation. (Ties to the safety posture in the
[Contribution Guide](../engineering/13-contribution-guide.md).)

### G-8 — Fast feedback loop for _us_ (DX of building Icarus)
Hot reload for UI, typed IPC, fast tests, and CI under ~10 minutes. **Why:** an
ambitious multi-integration product dies if the inner loop is slow.

## Explicit prioritization statement

For the first two milestones, **G-1, G-2, G-3, G-8 dominate G-4, G-5, G-6.** We would
rather ship a foundation that does _less_ but is correct and extensible than a demo
that does more but is a monolith. This is a deliberate, stated trade-off; if user
validation (OQ-2) shows we need a flashier first slice to get feedback, we revisit.
