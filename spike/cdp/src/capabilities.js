// @ts-check
// Phase 4 — Map the ceiling. Probe which CDP domains respond on this Hermes target,
// so we can draw the CDP-native vs in-app-bridge capability line.
// Usage: node src/capabilities.js ["<ws-url>"]
import { CdpClient } from "./lib/cdp.js";
import { discoverProxies } from "./lib/discovery.js";

// Domains we care about for the vision. `enable` is the cheapest liveness probe;
// where enable isn't meaningful we send a representative method.
const PROBES = [
  { domain: "Runtime", method: "Runtime.enable" },
  { domain: "Console", method: "Console.enable" },
  { domain: "Log", method: "Log.enable" },
  { domain: "Debugger", method: "Debugger.enable" },
  { domain: "Network", method: "Network.enable" },
  { domain: "HeapProfiler", method: "HeapProfiler.enable" },
  { domain: "Profiler", method: "Profiler.enable" },
  { domain: "Page", method: "Page.enable" }, // expected absent — RN is not a DOM
  { domain: "DOM", method: "DOM.enable" }, // expected absent
];

async function main() {
  const wsUrl = process.argv[2] ?? (await autoDiscover());
  if (!wsUrl) {
    console.log("[capabilities] no ws URL. Run `npm run discover` first.");
    process.exitCode = 1;
    return;
  }

  const client = new CdpClient(wsUrl);
  await client.connect();
  console.log(`[capabilities] connected: ${wsUrl}\n`);

  /** @type {{domain:string, method:string, status:string, note:string}[]} */
  const rows = [];
  for (const probe of PROBES) {
    try {
      await client.send(probe.method, {});
      rows.push({ ...probe, status: "SUPPORTED", note: "" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /not (implemented|found)|unknown|does not support/i.test(message)
        ? "UNSUPPORTED"
        : "ERROR";
      rows.push({ ...probe, status, note: message });
    }
  }

  console.log("[capabilities] --- CDP domain support (this target/version) ---");
  for (const r of rows) {
    console.log(`  ${pad(r.domain, 14)} ${pad(r.status, 12)} ${r.note}`);
  }
  console.log(
    "\n[capabilities] Record these in the report's capability matrix, then map each vision\n" +
      "               feature to: CDP-native | needs in-app bridge | impossible.\n" +
      "               (React tree / navigation / Redux are expected to need a bridge, not CDP.)"
  );
  client.close();
}

async function autoDiscover() {
  const proxies = await discoverProxies();
  for (const p of proxies) {
    const target = (p.targets ?? []).find((t) => t.webSocketDebuggerUrl);
    if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
  }
  return null;
}

/** @param {string} s @param {number} n */
const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));

main().catch((err) => {
  console.error("[capabilities] unexpected error:", err);
  process.exitCode = 1;
});
