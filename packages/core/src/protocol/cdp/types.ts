/**
 * Types for the CDP transport (E-14), productionizing the M0 spike
 * (docs/engineering/reports/cdp-spike-report.md). Icarus talks to Hermes via Metro's
 * inspector proxy over the Chrome DevTools Protocol (ADR-0008). Electron-free (ADR-0002);
 * the socket and fetch are injected so this is unit-testable without a network.
 */

/** A debuggable target as returned by Metro's `/json/list`. */
export interface CdpTarget {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly type?: string;
  readonly appId?: string;
  readonly deviceName?: string;
  readonly webSocketDebuggerUrl?: string;
  readonly reactNative?: {
    readonly logicalDeviceId?: string;
    readonly capabilities?: {
      readonly prefersFuseboxFrontend?: boolean;
      readonly nativePageReloads?: boolean;
      readonly nativeSourceCodeFetching?: boolean;
    };
  };
}

export interface ProxyDiscovery {
  readonly host: string;
  readonly port: number;
  readonly endpoint: string;
  readonly targets: readonly CdpTarget[];
}

/** Minimal fetch surface we depend on (so tests can inject a fake). */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * A minimal WebSocket-like transport. Electron main runs Node 20 (no global WebSocket),
 * so the desktop app injects a `ws`-backed factory; tests inject a fake. The spike found
 * that modern RN enforces an Origin CSRF check — the factory must send the Origin header.
 */
export interface CdpSocket {
  send(data: string): void;
  close(): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (error: Error) => void): void;
}

export type CdpSocketFactory = (url: string, options: { origin: string }) => CdpSocket;

export interface CdpClientOptions {
  readonly socketFactory: CdpSocketFactory;
  /** Default per-request timeout. The spike proved this is required — a starved
   *  connection hangs forever without it. Default 10000ms. */
  readonly requestTimeoutMs?: number;
  /** Override the derived Origin (default: http(s) origin of the ws URL). */
  readonly origin?: string;
}
