// @ts-check
// Minimal CDP client over the built-in global WebSocket (Node >= 21). Zero dependencies.
// Just enough to send commands, await results, and observe events for the spike.

/**
 * @typedef {(params: any) => void} EventHandler
 */

export class CdpClient {
  /** @param {string} webSocketDebuggerUrl */
  constructor(webSocketDebuggerUrl) {
    this.url = webSocketDebuggerUrl;
    this._nextId = 1;
    /** @type {Map<number, { resolve: (v:any)=>void, reject: (e:any)=>void }>} */
    this._pending = new Map();
    /** @type {Map<string, Set<EventHandler>>} */
    this._handlers = new Map();
    /** @type {WebSocket | null} */
    this._ws = null;
  }

  /** Open the socket and resolve once connected. */
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this._ws = ws;
      ws.addEventListener("open", () => resolve(undefined));
      ws.addEventListener("error", (e) => reject(new Error(`WebSocket error: ${describe(e)}`)));
      ws.addEventListener("close", () => this._rejectAllPending(new Error("socket closed")));
      ws.addEventListener("message", (ev) => this._onMessage(ev));
    });
  }

  /**
   * Send a CDP command and await its result.
   * A timeout is required: the spike found that when a second debugger connects Hermes
   * silently starves the first connection, so an un-timed request hangs forever.
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @param {number} [timeoutMs]
   * @returns {Promise<any>}
   */
  send(method, params = {}, timeoutMs = 10000) {
    if (!this._ws) throw new Error("not connected");
    const id = this._nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method} (connection may have been evicted)`));
      }, timeoutMs);
      this._pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      /** @type {WebSocket} */ (this._ws).send(payload);
    });
  }

  /**
   * Subscribe to a CDP event (e.g. "Runtime.consoleAPICalled").
   * @param {string} method
   * @param {EventHandler} handler
   */
  on(method, handler) {
    if (!this._handlers.has(method)) this._handlers.set(method, new Set());
    /** @type {Set<EventHandler>} */ (this._handlers.get(method)).add(handler);
  }

  close() {
    if (this._ws) this._ws.close();
  }

  /** @param {MessageEvent} ev */
  _onMessage(ev) {
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
    } catch {
      return; // ignore non-JSON frames
    }
    if (typeof msg.id === "number" && this._pending.has(msg.id)) {
      const { resolve, reject } = /** @type {any} */ (this._pending.get(msg.id));
      this._pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
      else resolve(msg.result);
      return;
    }
    if (typeof msg.method === "string") {
      const handlers = this._handlers.get(msg.method);
      if (handlers) for (const h of handlers) h(msg.params);
    }
  }

  /** @param {Error} err */
  _rejectAllPending(err) {
    for (const { reject } of this._pending.values()) reject(err);
    this._pending.clear();
  }
}

/** @param {any} e */
function describe(e) {
  if (e && typeof e.message === "string") return e.message;
  return "unknown";
}
