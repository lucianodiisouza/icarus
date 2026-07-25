// @ts-check
// Phase 1 — Discovery. Scan common Metro ports, print any CDP targets found.
// Usage: node src/discover.js  [--host localhost] [--ports 8081,19000]
import { discoverProxies } from "./lib/discovery.js";
import { DEFAULT_METRO_PORTS } from "./lib/ports.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ports = args.ports ? args.ports.split(",").map(Number) : DEFAULT_METRO_PORTS;
  const host = args.host ?? "localhost";

  console.log(`[discover] scanning ${host} ports: ${ports.join(", ")}`);
  const proxies = await discoverProxies({ host, ports });

  if (proxies.length === 0) {
    console.log("[discover] no inspector proxy found. Is Metro running with a Hermes app connected?");
    console.log("[discover] verdict signal: DISCOVERY FAILED for these ports (Phase 1).");
    process.exitCode = 1;
    return;
  }

  for (const proxy of proxies) {
    const targets = proxy.targets ?? [];
    console.log(`\n[discover] proxy on port ${proxy.port} via ${proxy.endpoint} — ${targets.length} target(s)`);
    targets.forEach((t, i) => {
      console.log(`  #${i} id=${t.id} type=${t.type ?? "?"} device=${t.deviceName ?? "?"}`);
      console.log(`      title: ${t.title ?? "(none)"}`);
      console.log(`      ws:    ${t.webSocketDebuggerUrl ?? "(none — cannot connect)"}`);
    });
  }
  console.log("\n[discover] copy a ws URL above into: npm run connect -- \"<ws-url>\"");
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ host?: string, ports?: string }} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--host") out.host = argv[++i];
    else if (argv[i] === "--ports") out.ports = argv[++i];
  }
  return out;
}

main().catch((err) => {
  console.error("[discover] unexpected error:", err);
  process.exitCode = 1;
});
