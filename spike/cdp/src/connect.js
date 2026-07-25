// @ts-check
// Phase 2 — Connect & read. Prove one real datum out of the app over CDP:
//   1) Runtime.evaluate("1+1") -> 2
//   2) capture a Runtime.consoleAPICalled event (our fixture logs "ICARUS_PROBE ...")
// Usage: node src/connect.js ["<ws-url>"]   (no url => auto-discover the first target)
import { CdpClient } from "./lib/cdp.js";
import { discoverProxies } from "./lib/discovery.js";

const PROBE_MARKER = "ICARUS_PROBE";
const LISTEN_MS = 8000;

async function main() {
  const wsUrl = process.argv[2] ?? (await autoDiscover());
  if (!wsUrl) {
    console.log("[connect] no ws URL (none passed, none discovered). Run `npm run discover` first.");
    process.exitCode = 1;
    return;
  }

  console.log(`[connect] connecting: ${wsUrl}`);
  const client = new CdpClient(wsUrl);
  await client.connect();
  console.log("[connect] connected.");

  let consoleSeen = 0;
  client.on("Runtime.consoleAPICalled", (params) => {
    const text = (params.args ?? []).map(previewArg).join(" ");
    const isProbe = text.includes(PROBE_MARKER);
    console.log(`[connect] console.${params.type}: ${text}${isProbe ? "   <-- PROBE MATCH" : ""}`);
    if (isProbe) consoleSeen++;
  });
  client.on("Runtime.exceptionThrown", (params) => {
    console.log(`[connect] exceptionThrown: ${params?.exceptionDetails?.text ?? "(no text)"}`);
  });

  await client.send("Runtime.enable");
  console.log("[connect] Runtime.enable ok.");

  const evalResult = await client.send("Runtime.evaluate", { expression: "1+1", returnByValue: true });
  const value = evalResult?.result?.value;
  console.log(`[connect] Runtime.evaluate("1+1") => ${JSON.stringify(value)} ${value === 2 ? "(PASS)" : "(UNEXPECTED)"}`);

  console.log(`[connect] listening ${LISTEN_MS}ms for "${PROBE_MARKER}" console logs...`);
  await delay(LISTEN_MS);

  console.log("\n[connect] --- Phase 2 result ---");
  console.log(`  C2a Runtime.evaluate result: ${value === 2 ? "PASS" : "FAIL"}`);
  console.log(`  C2b console.log captured:    ${consoleSeen > 0 ? `PASS (${consoleSeen})` : "FAIL (none seen)"}`);
  client.close();
  process.exitCode = value === 2 && consoleSeen > 0 ? 0 : 1;
}

async function autoDiscover() {
  const proxies = await discoverProxies();
  for (const p of proxies) {
    const target = (p.targets ?? []).find((t) => t.webSocketDebuggerUrl);
    if (target?.webSocketDebuggerUrl) {
      console.log(`[connect] auto-discovered target on port ${p.port}`);
      return target.webSocketDebuggerUrl;
    }
  }
  return null;
}

/** @param {any} arg */
function previewArg(arg) {
  if (arg == null) return String(arg);
  if ("value" in arg) return String(arg.value);
  if (arg.description) return String(arg.description);
  return arg.type ?? "?";
}

/** @param {number} ms */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

main().catch((err) => {
  console.error("[connect] unexpected error:", err);
  process.exitCode = 1;
});
