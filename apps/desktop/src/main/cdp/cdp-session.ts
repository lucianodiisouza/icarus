import { formatConsoleEvent, selectMainTarget } from '@icarus/core';
import type { CdpConsoleEntry, CdpTarget } from '@icarus/core';

/**
 * Orchestrates a live CDP session against a running RN app (E-14): discover a target → start
 * the multiplexing proxy in front of Hermes → connect our client through the proxy → enable
 * Runtime → stream console events out as normalized log entries. If the underlying socket
 * dies after a successful connect, the session auto-reconnects with exponential backoff
 * (slice 4 / C3) — re-discovering because the target URL may have changed across a reload
 * or a Metro restart.
 *
 * Dependencies are injected so this glue is unit-testable without sockets or an RN app.
 */
export type CdpSessionStatus =
  'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error';

export interface CdpClientLike {
  connect(): Promise<void>;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(method: string, handler: (params: unknown) => void): () => void;
  /**
   * Fires once when the underlying socket closes. The session uses this to trigger
   * auto-reconnect (E-14 slice 4).
   */
  onClose(handler: (reason: Error) => void): () => void;
  close(): void;
}

export interface CdpProxyLike {
  readonly downstreamUrl: string;
  close(): Promise<void>;
}

export interface CdpSessionDeps {
  /** Discover all attachable targets across running Metro instances. */
  discover(): Promise<CdpTarget[]>;
  /** Start the multiplexing proxy in front of the chosen Hermes target. */
  startProxy(upstreamUrl: string): Promise<CdpProxyLike>;
  /** Create a CDP client pointed at the proxy's downstream URL. */
  createClient(downstreamUrl: string): CdpClientLike;
  onLog(entry: CdpConsoleEntry): void;
  onStatus(status: CdpSessionStatus, detail?: string): void;
  /**
   * Sleep helper for backoff between reconnect attempts. Injected so tests can replace it
   * with a synchronous queue. Default: real setTimeout-based sleep.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Initial reconnect delay. Doubles each attempt up to the cap. Default 1000ms.
   * Tests can set this to 0 to skip backoff entirely.
   */
  reconnectInitialDelayMs?: number;
  /**
   * Cap on the reconnect delay. Default 30_000ms.
   */
  reconnectMaxDelayMs?: number;
}

const DEFAULT_RECONNECT_INITIAL_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

/** Public so tests can build the deps object without copying the default. */
export const cdpSessionDefaults = {
  reconnectInitialDelayMs: DEFAULT_RECONNECT_INITIAL_MS,
  reconnectMaxDelayMs: DEFAULT_RECONNECT_MAX_MS,
} as const;

export class CdpSession {
  readonly #deps: CdpSessionDeps;
  readonly #reconnectInitialMs: number;
  readonly #reconnectMaxMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  #proxy: CdpProxyLike | undefined;
  #client: CdpClientLike | undefined;
  #status: CdpSessionStatus = 'disconnected';
  #userDisconnected = false;
  #reconnectAttempts = 0;
  #reconnecting = false;

  constructor(deps: CdpSessionDeps) {
    this.#deps = deps;
    this.#reconnectInitialMs = deps.reconnectInitialDelayMs ?? DEFAULT_RECONNECT_INITIAL_MS;
    this.#reconnectMaxMs = deps.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_MS;
    this.#sleep =
      deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  get status(): CdpSessionStatus {
    return this.#status;
  }

  /**
   * Connect to the first attachable RN app and start streaming its console logs. Subsequent
   * drops of the underlying connection trigger auto-reconnect; an explicit `disconnect()`
   * is the only way to stop it.
   */
  async connect(): Promise<void> {
    if (this.#status === 'connecting' || this.#status === 'connected' || this.#reconnecting) {
      return;
    }
    this.#userDisconnected = false;
    this.#reconnectAttempts = 0;
    this.#setStatus('connecting');
    try {
      await this.#doConnect();
    } catch (error) {
      await this.#teardown();
      // Initial connect failure is terminal — don't auto-retry before the user has had a
      // successful connection. The error message is the actionable detail.
      this.#setStatus('error', error instanceof Error ? error.message : String(error));
    }
  }

  /** Stop the session and tear down the proxy. Idempotent. Cancels any in-flight reconnect. */
  async disconnect(): Promise<void> {
    this.#userDisconnected = true;
    await this.#teardown();
    this.#reconnectAttempts = 0;
    this.#setStatus('disconnected');
  }

  /**
   * One full attempt: discover → start proxy → create client → wire events → connect →
   * send `Runtime.enable`. Throws on any failure with the actionable reason. The caller
   * decides whether the throw is terminal (initial connect) or recoverable (auto-reconnect).
   */
  async #doConnect(): Promise<void> {
    const target = selectMainTarget(await this.#deps.discover());
    if (!target?.webSocketDebuggerUrl) {
      throw new Error('No attachable React Native app found. Is Metro running?');
    }

    const proxy = await this.#deps.startProxy(target.webSocketDebuggerUrl);
    const client = this.#deps.createClient(proxy.downstreamUrl);

    // Subscribe BEFORE connecting so we never miss a close that races the open.
    // The close handler is the auto-reconnect trigger — but only fires when WE think we're
    // connected; the session state machine guards against double-fires.
    const offClose = client.onClose((reason) => {
      if (this.#status === 'connected') {
        void this.#attemptReconnect(reason);
      }
    });
    client.on('Runtime.consoleAPICalled', (params) => {
      const entry = formatConsoleEvent(params);
      if (entry) this.#deps.onLog(entry);
    });

    // If connect() itself throws, unsubscribe so the close we trigger via teardown
    // doesn't start a reconnect we don't want.
    try {
      await client.connect();
      await client.send('Runtime.enable');
    } catch (error) {
      offClose();
      // Best-effort cleanup of the half-initialized client/proxy. Done in-line so a
      // failure path here can't be observed as a "connected" session.
      try {
        client.close();
      } catch {
        // ignore — we're already on the error path
      }
      try {
        await proxy.close();
      } catch {
        // ignore
      }
      throw error;
    }

    this.#proxy = proxy;
    this.#client = client;
    this.#setStatus('connected', target.description ?? target.title ?? 'React Native app');
  }

  /**
   * Reconnect loop: backoff, then re-run #doConnect. Stops on a successful connect (resets
   * backoff) or on a user disconnect. Treats repeated failures as a single terminal `error`
   * state — a session that can't re-find a target isn't going to fix itself by trying
   * again, and we don't want to spam the discover endpoint.
   */
  async #attemptReconnect(reason: Error): Promise<void> {
    if (this.#userDisconnected || this.#reconnecting || this.#status !== 'connected') {
      return;
    }
    this.#reconnecting = true;
    // Clear the stale client/proxy so a partial #teardown doesn't double-close.
    this.#client = undefined;
    this.#proxy = undefined;

    try {
      while (!this.#userDisconnected) {
        this.#reconnectAttempts += 1;
        const delay = Math.min(
          this.#reconnectInitialMs * 2 ** (this.#reconnectAttempts - 1),
          this.#reconnectMaxMs,
        );
        this.#setStatus(
          'reconnecting',
          `Connection lost (${reason.message}). Retrying in ${Math.round(delay)}ms (attempt ${this.#reconnectAttempts}).`,
        );
        await this.#sleep(delay);
        if (this.#userDisconnected) return;

        try {
          await this.#doConnect();
          // Success — reset backoff and exit the loop. onClose from the new client will
          // take over for the next drop.
          this.#reconnectAttempts = 0;
          return;
        } catch (error) {
          // Tear down any half-initialized client/proxy before the next attempt.
          await this.#teardown();
          reason = error instanceof Error ? error : new Error(String(error));
        }
      }
    } finally {
      this.#reconnecting = false;
    }
  }

  async #teardown(): Promise<void> {
    this.#client?.close();
    this.#client = undefined;
    await this.#proxy?.close();
    this.#proxy = undefined;
  }

  #setStatus(status: CdpSessionStatus, detail?: string): void {
    this.#status = status;
    this.#deps.onStatus(status, detail);
  }
}
