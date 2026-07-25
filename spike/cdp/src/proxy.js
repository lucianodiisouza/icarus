// @ts-check
// Phase 3 — Coexistence via a MULTIPLEXING PROXY.
//
// Hermes allows only ONE concurrent CDP debugger connection. To let Icarus AND the
// user's own RN DevTools share it, we sit in the middle: one upstream connection to
// Hermes, multiple downstream clients. Commands are id-rewritten per client so replies
// route back correctly; events (no id) are broadcast to all clients.
//
// This is the real engineering the spike must prove/measure. It is NOT zero-dependency:
// Node has no built-in WebSocket *server*, so this phase uses the standard `ws` package.
// Install it here first:   npm install ws
//
// Usage: node src/proxy.js "<upstream-hermes-ws-url>" [--port 9223]
//   then point RN DevTools / a second `connect.js` at ws://localhost:9223

import { CdpClient } from "./lib/cdp.js";

const DOWNSTREAM_PORT = getPort(process.argv) ?? 9223;

async function main() {
  const upstreamUrl = process.argv[2];
  if (!upstreamUrl || upstreamUrl.startsWith("--")) {
    console.log('[proxy] usage: node src/proxy.js "<upstream-hermes-ws-url>" [--port 9223]');
    process.exitCode = 1;
    return;
  }

  const WebSocketServer = await loadWsServer();
  if (!WebSocketServer) return; // guidance already printed

  // Upstream: the single allowed Hermes connection.
  const upstream = new CdpClient(upstreamUrl);
  await upstream.connect();
  console.log(`[proxy] upstream connected: ${upstreamUrl}`);

  // Broadcast every upstream EVENT to all downstream clients.
  /** @type {Set<any>} */
  const clients = new Set();
  wireEventBroadcast(upstream, clients);

  const server = new WebSocketServer({ port: DOWNSTREAM_PORT });
  console.log(`[proxy] downstream listening: ws://localhost:${DOWNSTREAM_PORT}`);
  console.log("[proxy] point RN DevTools (or a second connect.js) here, then compare behavior.");

  server.on("connection", (socket) => {
    clients.add(socket);
    console.log(`[proxy] client connected (${clients.size} total)`);
    socket.on("message", (data) => handleClientMessage(upstream, socket, data));
    socket.on("close", () => {
      clients.delete(socket);
      console.log(`[proxy] client disconnected (${clients.size} total)`);
    });
  });
}

/**
 * Forward a downstream command upstream, then route the single reply back to the
 * originating client only, preserving that client's original message id.
 * @param {CdpClient} upstream
 * @param {any} socket
 * @param {any} data
 */
async function handleClientMessage(upstream, socket, data) {
  /** @type {any} */
  let msg;
  try {
    msg = JSON.parse(String(data));
  } catch {
    return; // ignore non-JSON
  }
  const originalId = msg.id;
  try {
    const result = await upstream.send(msg.method, msg.params ?? {});
    socket.send(JSON.stringify({ id: originalId, result }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    socket.send(JSON.stringify({ id: originalId, error: { code: -32000, message } }));
  }
}

/**
 * Subscribe to a broad set of upstream events and fan them out. For the spike we
 * broadcast the domains we care about; a production proxy would forward all events.
 * @param {CdpClient} upstream
 * @param {Set<any>} clients
 */
function wireEventBroadcast(upstream, clients) {
  const events = [
    "Runtime.consoleAPICalled",
    "Runtime.exceptionThrown",
    "Log.entryAdded",
    "Network.requestWillBeSent",
    "Network.responseReceived",
    "Debugger.paused",
  ];
  for (const method of events) {
    upstream.on(method, (params) => {
      const frame = JSON.stringify({ method, params });
      for (const socket of clients) socket.send(frame);
    });
  }
}

/** Dynamically import `ws`; print install guidance if absent. */
async function loadWsServer() {
  try {
    const mod = await import("ws");
    return mod.WebSocketServer;
  } catch {
    console.log("[proxy] the `ws` package is required for Phase 3 (Node has no built-in WS server).");
    console.log("[proxy] install it inside spike/cdp:   npm install ws");
    process.exitCode = 1;
    return null;
  }
}

/** @param {string[]} argv */
function getPort(argv) {
  const i = argv.indexOf("--port");
  return i >= 0 ? Number(argv[i + 1]) : null;
}

main().catch((err) => {
  console.error("[proxy] unexpected error:", err);
  process.exitCode = 1;
});
