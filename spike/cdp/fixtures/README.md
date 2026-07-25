# Spike Fixtures

Three minimal, Hermes-enabled apps so the spike can be run against each target the
locked decision requires (bare RN + Expo). Each fixture needs the **same two things**:

1. A screen that emits a **known console log on a timer**:
   ```js
   let n = 0;
   setInterval(() => console.log("ICARUS_PROBE", n++), 1000);
   ```
   (`connect.js` looks for the `ICARUS_PROBE` marker.)
2. A **button that throws**, so we can observe `Runtime.exceptionThrown`:
   ```js
   <Button title="throw" onPress={() => { throw new Error("ICARUS_PROBE throw"); }} />
   ```

Fixtures are **not committed** (they're large, generated projects). Create them locally
under this directory; `.gitignore` excludes their build artifacts. Record the exact
versions you used in the report.

| Fixture dir | How to create | Notes |
|-------------|---------------|-------|
| `fixture-bare/` | `npx @react-native-community/cli init FixtureBare` | Hermes is default; iOS sim + Android emulator |
| `fixture-expo-devclient/` | `npx create-expo-app FixtureExpo` then add `expo-dev-client` | Run with a dev build (not Expo Go) |
| `fixture-expo-go/` | Same Expo app, run in **Expo Go** | The constrained worst case (P2 in the rubric) |

## Running the loop against a fixture

```bash
# 1) start the fixture app on a simulator/emulator (its own Metro comes up)
# 2) from spike/cdp:
npm run discover                 # confirm the target shows up
npm run connect                  # prove evaluate + console capture
npm run capabilities             # map supported CDP domains
npm install ws && npm run proxy -- "<ws-url>"   # test coexistence with RN DevTools
```

Record the version matrix (RN / Expo / Hermes / Metro / OS / device) — the verdict is
only valid for versions actually tested, and the report must say so.
