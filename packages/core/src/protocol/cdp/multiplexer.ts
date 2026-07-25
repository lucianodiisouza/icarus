/**
 * CDP multiplexer (E-14) — the routing brain of the multiplexing proxy that lets Icarus
 * and the user's own RN DevTools share Hermes' SINGLE debugger connection (ADR-0008,
 * OQ-14). One upstream connection to Hermes; many downstream clients.
 *
 * The hard part is id-collision: every debugger numbers its own commands from 1, so two
 * clients both send `id:1`. We rewrite each downstream command to a globally-unique
 * upstream id, remember which client/original-id it belongs to, and rewrite the id back on
 * the response. Events (no id) are broadcast to every client.
 *
 * Pure and transport-agnostic (Electron-free, ADR-0002): `upstreamSend` and each client's
 * `send` are injected, so this is fully unit-testable without sockets. The `ws`-based
 * server that drives it lives in the app (apps/desktop/src/main/cdp).
 */
export type SendFrame = (frame: string) => void;

interface Mapping {
  readonly clientId: string;
  readonly originalId: number;
}

export class CdpMultiplexer {
  readonly #upstreamSend: SendFrame;
  readonly #clients = new Map<string, SendFrame>();
  readonly #idMap = new Map<number, Mapping>();
  #nextUpstreamId = 1;
  #clientSeq = 0;

  constructor(upstreamSend: SendFrame) {
    this.#upstreamSend = upstreamSend;
  }

  /** Register a downstream client; returns its id. */
  addClient(send: SendFrame): string {
    const clientId = `client-${++this.#clientSeq}`;
    this.#clients.set(clientId, send);
    return clientId;
  }

  /** Remove a client and drop any of its in-flight command mappings. */
  removeClient(clientId: string): void {
    this.#clients.delete(clientId);
    for (const [upstreamId, mapping] of this.#idMap) {
      if (mapping.clientId === clientId) this.#idMap.delete(upstreamId);
    }
  }

  clientCount(): number {
    return this.#clients.size;
  }

  /** In-flight (awaiting-response) command count — for diagnostics/tests. */
  pendingCount(): number {
    return this.#idMap.size;
  }

  /** A frame arriving from a downstream client (a debugger command). */
  handleDownstream(clientId: string, frame: string): void {
    if (!this.#clients.has(clientId)) return;
    const message = parse(frame);
    if (message === null) return;

    if (typeof message['id'] === 'number') {
      const upstreamId = this.#nextUpstreamId++;
      this.#idMap.set(upstreamId, { clientId, originalId: message['id'] });
      this.#upstreamSend(JSON.stringify({ ...message, id: upstreamId }));
    } else {
      // A frame without an id (unusual for a debugger) — forward verbatim.
      this.#upstreamSend(frame);
    }
  }

  /** A frame arriving from the upstream Hermes connection (response or event). */
  handleUpstream(frame: string): void {
    const message = parse(frame);
    if (message === null) return;

    if (typeof message['id'] === 'number') {
      // A command response: route back to the originating client with its original id.
      const mapping = this.#idMap.get(message['id']);
      if (!mapping) return; // unknown/stale id (e.g. client already disconnected) — drop
      this.#idMap.delete(message['id']);
      const send = this.#clients.get(mapping.clientId);
      send?.(JSON.stringify({ ...message, id: mapping.originalId }));
    } else {
      // An event: broadcast to every connected client.
      for (const send of this.#clients.values()) send(frame);
    }
  }
}

function parse(frame: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(frame);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
