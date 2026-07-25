import { describe, expect, it, vi } from 'vitest';
import type { CdpConsoleEntry, CdpTarget } from '@icarus/core';
import { CdpSession, type CdpClientLike, type CdpSessionDeps } from './cdp-session.js';

const target: CdpTarget = {
  id: 't1',
  description: 'React Native Bridgeless',
  webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?device=d&page=1',
  reactNative: { capabilities: { prefersFuseboxFrontend: true } },
};

function makeDeps(overrides: Partial<CdpSessionDeps> = {}) {
  const logs: CdpConsoleEntry[] = [];
  const statuses: Array<{ status: string; detail?: string }> = [];
  let consoleHandler: ((params: unknown) => void) | undefined;

  const client: CdpClientLike = {
    connect: vi.fn(async () => {}),
    send: vi.fn(async () => ({})),
    on: vi.fn((_method, handler) => {
      consoleHandler = handler;
      return () => {};
    }),
    close: vi.fn(),
  };
  const proxy = { downstreamUrl: 'ws://localhost:9999', close: vi.fn(async () => {}) };

  const deps: CdpSessionDeps = {
    discover: vi.fn(async () => [target]),
    startProxy: vi.fn(async () => proxy),
    createClient: vi.fn(() => client),
    onLog: (e) => logs.push(e),
    onStatus: (status, detail) => statuses.push({ status, ...(detail ? { detail } : {}) }),
    ...overrides,
  };
  return { deps, client, proxy, logs, statuses, emitConsole: (p: unknown) => consoleHandler?.(p) };
}

describe('CdpSession', () => {
  it('connects: discover → proxy → client → Runtime.enable, and reports connected', async () => {
    const { deps, client, proxy, statuses } = makeDeps();
    const session = new CdpSession(deps);

    await session.connect();

    expect(deps.startProxy).toHaveBeenCalledWith(target.webSocketDebuggerUrl);
    expect(deps.createClient).toHaveBeenCalledWith(proxy.downstreamUrl);
    expect(client.connect).toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledWith('Runtime.enable');
    expect(session.status).toBe('connected');
    expect(statuses.map((s) => s.status)).toEqual(['connecting', 'connected']);
  });

  it('streams console events as normalized log entries', async () => {
    const { deps, logs, emitConsole } = makeDeps();
    const session = new CdpSession(deps);
    await session.connect();

    emitConsole({
      type: 'error',
      timestamp: 42,
      args: [{ type: 'string', value: 'boom' }],
    });

    expect(logs).toEqual([{ level: 'error', text: 'boom', timestampMs: 42 }]);
  });

  it('reports an error status when no target is found', async () => {
    const { deps } = makeDeps({ discover: vi.fn(async () => []) });
    const session = new CdpSession(deps);

    await session.connect();

    expect(session.status).toBe('error');
  });

  it('tears down proxy + client and reports an error when connect throws', async () => {
    const { deps, proxy, client } = makeDeps({
      createClient: vi.fn(() => ({
        connect: vi.fn(async () => {
          throw new Error('socket closed');
        }),
        send: vi.fn(async () => ({})),
        on: vi.fn(() => () => {}),
        close: vi.fn(),
      })),
    });
    const session = new CdpSession(deps);

    await session.connect();

    expect(session.status).toBe('error');
    expect(proxy.close).toHaveBeenCalled();
    void client;
  });

  it('disconnect closes the client and proxy and returns to disconnected', async () => {
    const { deps, client, proxy } = makeDeps();
    const session = new CdpSession(deps);
    await session.connect();

    await session.disconnect();

    expect(client.close).toHaveBeenCalled();
    expect(proxy.close).toHaveBeenCalled();
    expect(session.status).toBe('disconnected');
  });

  it('is idempotent: a second connect while connected is a no-op', async () => {
    const { deps } = makeDeps();
    const session = new CdpSession(deps);
    await session.connect();
    await session.connect();
    expect(deps.discover).toHaveBeenCalledTimes(1);
  });
});
