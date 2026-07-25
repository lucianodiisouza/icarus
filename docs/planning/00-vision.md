# 00 — Vision

## The one-liner

**Icarus is "Claude Code for React Native development":** a single desktop
application where a React Native developer runs, inspects, debugs, understands,
and interacts with their app — with an AI assistant that has full context on
everything the tool can see.

## The problem we're solving

React Native debugging today is **fragmented across a dozen disconnected tools**:

- Metro runs in one terminal.
- Logs are split between Metro, `adb logcat`, and the iOS system log.
- React DevTools is a separate Electron/browser app.
- Hermes debugging goes through Chrome DevTools or the new RN DevTools.
- Native device state (databases, AsyncStorage, MMKV, files) requires manual
  `adb`/`xcrun` incantations.
- Network inspection needs Flipper (now deprecated/uncertain), Reactotron, or
  proxy tooling.
- Component tree, navigation state, performance, and native logs each live
  somewhere else.

The developer becomes a human message bus, copy-pasting between windows and holding
the mental model in their head. The context that would make an AI assistant genuinely
useful — the logs, the component tree, the network calls, the device state — is
scattered and never assembled in one place.

**Icarus's bet:** the value is not any single inspector. The value is _one place that
already has all the context assembled_, and an AI layer that can reason over it.

## Why now

- **Flipper's decline** left a gap in the RN debugging ecosystem.
- **React Native DevTools** (the Hermes + CDP-based successor) is becoming the
  official direction, giving us a stable protocol (CDP) to build on instead of a
  proprietary plugin system.
- **Hermes is now the default engine**, making CDP-based inspection viable across
  the ecosystem.
- **LLM-assisted development** proved (via tools like Claude Code) that developers
  will adopt an AI collaborator when it has real context and can take real actions.

## The long-term vision (where this goes)

Icarus eventually becomes the developer's **home base** for an RN app. Over time it
integrates (in no committed order — see [Milestones](07-milestones.md)):

Metro · React Native DevTools · Hermes · ADB · iOS Simulator · Android Emulator ·
AI Assistant · Network inspection · React Component Tree · AsyncStorage · SQLite ·
MMKV · Logs · Performance · Navigation · Native logs · Device management · Build system

**Explicitly, none of these are being implemented now.** They define the _shape of
the ambition_ so that the foundation we build in the first milestones does not paint
us into a corner. The first goal is to **build the project's foundation correctly**
so that adding any one of these later is a well-understood, low-friction operation.

## Design principles (the taste that guides decisions)

1. **Context is the product.** Every feature should feed a shared, structured model
   of "what is happening in this app right now." That model is what makes the AI
   assistant valuable.
2. **The developer stays in control.** The AI proposes and assists; it never takes
   irreversible device/app actions without explicit confirmation.
3. **Native-fidelity, not lowest-common-denominator.** We drive `adb`, `simctl`,
   Metro, and CDP directly rather than wrapping a weaker abstraction.
4. **Boring, observable core.** The plumbing (process management, protocol clients,
   IPC) must be dead reliable and heavily instrumented. Flashy features sit on top of
   a boring, trustworthy base.
5. **Extensible by design.** Each integration (Metro, ADB, Network…) is a _plugin-
   shaped module_ behind a stable internal contract, so features can be built,
   tested, and shipped independently.
6. **Plan, then build.** (See the process in the [README](../README.md).)

## What "done" looks like for the vision (not for v1)

A React Native developer opens Icarus, points it at their project, and never opens a
terminal, Flipper, Chrome DevTools, or a raw `adb` shell again for the day-to-day
debug loop — and the AI assistant can answer "why did this screen re-render 40 times?"
because it can see the component tree, the props, and the render timeline together.

## Assumptions & open questions feeding this vision

- The RN DevTools / CDP direction remains the ecosystem's official path (OQ-4).
- Enough developers feel the fragmentation pain to switch tools (OQ-2 — needs
  validation via user interviews).
- We can deliver a _thin but real_ first slice fast enough to learn (see
  [Milestones](07-milestones.md)).
