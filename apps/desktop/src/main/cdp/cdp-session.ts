import { formatConsoleEvent, selectMainTarget } from '@icarus/core';
import type { CdpConsoleEntry, CdpTarget } from '@icarus/core';

/**
 * Orchestrates a live CDP session against a running RN app (E-14 live wiring): discover a
 * target → start the multiplexing proxy in front of Hermes → connect our client through
 * the proxy → enable Runtime → stream console events out as normalized log entries.
 *
 * Dependencies are injected so this glue is unit-testable without sockets or an RN app.
 */
export type CdpSessionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface CdpClientLike {
  connect(): Promise<void>;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(method: string, handler: (params: unknown) => void): () => void;
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
}

export class CdpSession {
  readonly #deps: CdpSessionDeps;
  #proxy: CdpProxyLike | undefined;
  #client: CdpClientLike | undefined;
  #status: CdpSessionStatus = 'disconnected';

  constructor(deps: CdpSessionDeps) {
    this.#deps = deps;
  }

  get status(): CdpSessionStatus {
    return this.#status;
  }

  /** Connect to the first attachable RN app and start streaming its console logs. */
  async connect(): Promise<void> {
    if (this.#status === 'connecting' || this.#status === 'connected') return;
    this.#setStatus('connecting');
    try {
      const target = selectMainTarget(await this.#deps.discover());
      if (!target?.webSocketDebuggerUrl) {
        this.#setStatus('error', 'No attachable React Native app found. Is Metro running?');
        return;
      }

      this.#proxy = await this.#deps.startProxy(target.webSocketDebuggerUrl);
      this.#client = this.#deps.createClient(this.#proxy.downstreamUrl);
      this.#client.on('Runtime.consoleAPICalled', (params) => {
        const entry = formatConsoleEvent(params);
        if (entry) this.#deps.onLog(entry);
      });

      await this.#client.connect();
      await this.#client.send('Runtime.enable');
      this.#setStatus('connected', target.description ?? target.title ?? 'React Native app');
    } catch (error) {
      await this.#teardown();
      this.#setStatus('error', error instanceof Error ? error.message : String(error));
    }
  }

  /** Stop the session and tear down the proxy. Idempotent. */
  async disconnect(): Promise<void> {
    await this.#teardown();
    this.#setStatus('disconnected');
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
