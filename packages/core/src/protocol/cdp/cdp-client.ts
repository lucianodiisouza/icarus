import { EventBus } from '../../event-bus/event-bus.js';
import type { Unsubscribe } from '../../event-bus/event-bus.js';
import type { CdpClientOptions, CdpSocket } from './types.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

export class CdpError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = 'CdpError';
    this.code = code;
  }
}

interface Pending {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * A Chrome DevTools Protocol client over Metro's inspector proxy (E-14, ADR-0008).
 * Productionizes the M0 spike with its two hard-won lessons baked in:
 *  1. Modern RN enforces an Origin CSRF check — we send `Origin: http(s)://<host>` (the
 *     sanctioned path official DevTools uses; we do not bypass it).
 *  2. Every request has a timeout — a starved connection (a second debugger evicting us)
 *     otherwise hangs forever.
 * The socket is injected (Electron main is Node 20 with no global WebSocket; tests fake it).
 */
export class CdpClient {
  readonly #url: string;
  readonly #origin: string;
  readonly #requestTimeoutMs: number;
  readonly #socket: CdpSocket;
  readonly #pending = new Map<number, Pending>();
  readonly #events = new EventBus<Record<string, unknown>>();
  readonly #closeHandlers = new Set<(reason: Error) => void>();
  #nextId = 1;
  #closed = false;

  constructor(url: string, options: CdpClientOptions) {
    this.#url = url;
    this.#origin = options.origin ?? httpOriginFromWsUrl(url);
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#socket = options.socketFactory(url, { origin: this.#origin });
  }

  get url(): string {
    return this.#url;
  }
  get origin(): string {
    return this.#origin;
  }

  /** Open the socket and resolve once connected (or reject on error/close). */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.#socket.onOpen(() => {
        settled = true;
        resolve();
      });
      this.#socket.onError((error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      this.#socket.onClose(() => {
        this.#onClosed(new Error('socket closed'));
        if (!settled) {
          settled = true;
          reject(new Error('socket closed before open'));
        }
      });
      this.#socket.onMessage((data) => this.#onMessage(data));
    });
  }

  /** Send a CDP command and await its result. Rejects on CDP error or timeout. */
  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error('CDP client is closed'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new Error(
            `CDP timeout after ${this.#requestTimeoutMs}ms: ${method} (connection may have been evicted)`,
          ),
        );
      }, this.#requestTimeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Subscribe to a CDP event (e.g. "Runtime.consoleAPICalled"). */
  on(method: string, handler: (params: unknown) => void): Unsubscribe {
    return this.#events.on(method, handler);
  }

  /**
   * Subscribe to the underlying socket close. Fires once with the close reason (any further
   * `send` will reject). Use this to drive reconnect at the session level — E-14 slice 4
   * (auto-reconnect across app reload / Metro restart).
   */
  onClose(handler: (reason: Error) => void): Unsubscribe {
    this.#closeHandlers.add(handler);
    return () => {
      this.#closeHandlers.delete(handler);
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#socket.close();
    this.#onClosed(new Error('client closed'));
  }

  #onMessage(data: string): void {
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return; // ignore non-JSON frames
    }
    if (!isRecord(message)) return;

    if (typeof message['id'] === 'number') {
      const pending = this.#pending.get(message['id']);
      if (!pending) return;
      this.#pending.delete(message['id']);
      clearTimeout(pending.timer);
      const error = message['error'];
      if (isRecord(error)) {
        pending.reject(new CdpError(String(error['message']), Number(error['code'] ?? -1)));
      } else {
        pending.resolve(message['result']);
      }
      return;
    }

    if (typeof message['method'] === 'string') {
      this.#events.emit(message['method'], message['params']);
    }
  }

  #onClosed(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    // Snapshot then clear, so an unsubscribing handler doesn't skip siblings.
    const handlers = [...this.#closeHandlers];
    this.#closeHandlers.clear();
    for (const handler of handlers) {
      try {
        handler(error);
      } catch {
        // A throwing close handler must not prevent the others from running. Errors are
        // intentionally swallowed here — the socket is gone, there's nowhere useful to send
        // them. Surfaces loudly only if a handler's call site chooses to.
      }
    }
  }
}

/** Derive an allowed http(s) Origin from a ws(s) URL (ws://localhost:8081 → http://localhost:8081). */
export function httpOriginFromWsUrl(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    const scheme = u.protocol === 'wss:' ? 'https:' : 'http:';
    return `${scheme}//${u.host}`;
  } catch {
    return 'http://localhost:8081';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
