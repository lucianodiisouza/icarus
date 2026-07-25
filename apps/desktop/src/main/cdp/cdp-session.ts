import {
  formatConsoleEvent,
  formatNetworkEvent,
  NETWORK_EVENTS,
  selectMainTarget,
} from '@icarus/core';
import type { CdpConsoleEntry, CdpNetworkEvent, CdpTarget } from '@icarus/core';

/**
 * Orchestrates a live CDP session against a running RN app (E-14): discover a target → start
 * the multiplexing proxy in front of Hermes → connect our client through the proxy → enable
 * Runtime + Network → stream console + network events out as normalized records. If the
 * underlying socket dies after a successful connect, the session auto-reconnects with
 * exponential backoff (slice 4 / C3) — re-discovering because the target URL may have
 * changed across a reload or a Metro restart.
 *
 * Dependencies are injected so this glue is unit-testable without sockets or an RN app.
 */
export type CdpSessionStatus =
  'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error';

/** Whether the running RN app supports the CDP `Network` domain. */
export type CdpSessionNetworkSupport = 'available' | 'unavailable';

/** Status event payload — opaque to the session, mapped to IPC by the caller. */
export interface CdpSessionStatusEvent {
  readonly status: CdpSessionStatus;
  readonly detail?: string;
  readonly networkSupport?: CdpSessionNetworkSupport;
}

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
  /** Stream of normalized network events (E-14 slice 5). */
  onNetwork(event: CdpNetworkEvent): void;
  onStatus(event: CdpSessionStatusEvent): void;
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
  #networkSupport: CdpSessionNetworkSupport | undefined;
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

  get networkSupport(): CdpSessionNetworkSupport | undefined {
    return this.#networkSupport;
  }

  /**
   * Connect to the first attachable RN app and start streaming its console + network events.
   * Subsequent drops of the underlying connection trigger auto-reconnect; an explicit
   * `disconnect()` is the only way to stop it.
   */
  async connect(): Promise<void> {
    if (this.#status === 'connecting' || this.#status === 'connected' || this.#reconnecting) {
      return;
    }
    this.#userDisconnected = false;
    this.#reconnectAttempts = 0;
    this.#networkSupport = undefined;
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
    this.#networkSupport = undefined;
    this.#setStatus('disconnected');
  }

  /**
   * One full attempt: discover → start proxy → create client → wire events → connect →
   * send `Runtime.enable` + `Network.enable` (best-effort). Throws on any failure with the
   * actionable reason. The caller decides whether the throw is terminal (initial connect)
   * or recoverable (auto-reconnect).
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
    // Network events are best-effort — if Network.enable fails (RN < 0.76, etc.) we still
    // ship a working console stream. Subscribing to the events is cheap; the lack of an
    // enable means the events just never fire, so this is a no-op in the unsupported case.
    client.on(NETWORK_EVENTS.REQUEST_WILL_BE_SENT, (params) =>
      this.#forwardNetwork('Network.requestWillBeSent', params),
    );
    client.on(NETWORK_EVENTS.RESPONSE_RECEIVED, (params) =>
      this.#forwardNetwork('Network.responseReceived', params),
    );
    client.on(NETWORK_EVENTS.LOADING_FAILED, (params) =>
      this.#forwardNetwork('Network.loadingFailed', params),
    );

    // If connect() itself throws, unsubscribe so the close we trigger via teardown
    // doesn't start a reconnect we don't want.
    try {
      await client.connect();
      await client.send('Runtime.enable');
      // Network.enable is best-effort: success → stream network events, failure → mark
      // the session's networkSupport as 'unavailable' and keep going. Either way the
      // session is fully usable for the console stream.
      await this.#tryEnableNetwork(client);
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
   * Try to enable the CDP Network domain. The spike proved RN ≥ 0.76 supports it natively;
   * older RN rejects with a "method not found" / "domain not supported" error. We surface
   * the result via `networkSupport` so the UI can show "Network: not supported on this
   * version" rather than just silently not showing events.
   */
  async #tryEnableNetwork(client: CdpClientLike): Promise<void> {
    try {
      await client.send('Network.enable');
      this.#setNetworkSupport('available');
    } catch {
      this.#setNetworkSupport('unavailable');
    }
  }

  #forwardNetwork(method: string, params: unknown): void {
    if (this.#networkSupport !== 'available') return;
    const event = formatNetworkEvent(method, params);
    if (event) this.#deps.onNetwork(event);
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
    const event: CdpSessionStatusEvent =
      this.#networkSupport !== undefined
        ? {
            status,
            ...(detail !== undefined ? { detail } : {}),
            networkSupport: this.#networkSupport,
          }
        : { status, ...(detail !== undefined ? { detail } : {}) };
    this.#deps.onStatus(event);
  }

  #setNetworkSupport(support: CdpSessionNetworkSupport): void {
    this.#networkSupport = support;
    // Re-emit the current status so the renderer sees the support change without
    // needing a separate channel. A no-op when we're already in this support state.
    this.#setStatus(this.#status);
  }
}
