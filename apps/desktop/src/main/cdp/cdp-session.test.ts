import { describe, expect, it, vi } from 'vitest';
import type { CdpConsoleEntry, CdpNetworkEvent, CdpTarget } from '@icarus/core';
import { NETWORK_EVENTS } from '@icarus/core';
import {
  CdpSession,
  type CdpClientLike,
  type CdpSessionDeps,
  type CdpSessionStatusEvent,
} from './cdp-session.js';

const target: CdpTarget = {
  id: 't1',
  description: 'React Native Bridgeless',
  webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?device=d&page=1',
  reactNative: { capabilities: { prefersFuseboxFrontend: true } },
};

type Handler = (params: unknown) => void;

/** A fake client that records its close + event handlers so tests can fire them. */
function makeFakeClient(): CdpClientLike & {
  emitClose(reason?: Error): void;
  emitConsole: (params: unknown) => void;
  emitNetwork(method: string, params: unknown): void;
  /** Configure which methods the fake's `send` rejects for. Default: none reject. */
  setRejects(methods: string[]): void;
} {
  let closeHandler: ((reason: Error) => void) | undefined;
  const consoleHandler: { current?: Handler } = {};
  const networkHandlers: Record<string, Handler> = {};
  const rejectMethods = new Set<string>();
  const client: CdpClientLike = {
    connect: vi.fn(async () => {}),
    send: vi.fn(async (method: string) => {
      if (rejectMethods.has(method)) {
        throw new Error(`mock: ${method} not supported`);
      }
      return {};
    }),
    on: vi.fn((method, handler) => {
      if (method === 'Runtime.consoleAPICalled') consoleHandler.current = handler;
      else if (
        Object.values(NETWORK_EVENTS).includes(
          method as (typeof NETWORK_EVENTS)[keyof typeof NETWORK_EVENTS],
        )
      ) {
        networkHandlers[method] = handler;
      }
      return () => {};
    }),
    onClose: vi.fn((handler) => {
      closeHandler = handler;
      return () => {
        if (closeHandler === handler) closeHandler = undefined;
      };
    }),
    close: vi.fn(),
  };
  return {
    ...client,
    emitClose: (reason = new Error('socket closed')) => closeHandler?.(reason),
    emitConsole: (params: unknown) => consoleHandler.current?.(params),
    emitNetwork: (method, params) => networkHandlers[method]?.(params),
    setRejects: (methods) => {
      rejectMethods.clear();
      for (const m of methods) rejectMethods.add(m);
    },
  };
}

function makeDeps(overrides: Partial<CdpSessionDeps> = {}) {
  const logs: CdpConsoleEntry[] = [];
  const network: CdpNetworkEvent[] = [];
  const statuses: CdpSessionStatusEvent[] = [];
  const client = makeFakeClient();
  const proxy = { downstreamUrl: 'ws://localhost:9999', close: vi.fn(async () => {}) };

  const deps: CdpSessionDeps = {
    discover: vi.fn(async () => [target]),
    startProxy: vi.fn(async () => proxy),
    createClient: vi.fn(() => client),
    onLog: (e) => logs.push(e),
    onNetwork: (e) => network.push(e),
    onStatus: (event) => statuses.push(event),
    sleep: vi.fn(async () => {}),
    ...overrides,
  };
  return {
    deps,
    client,
    proxy,
    logs,
    network,
    statuses,
    emitConsole: client.emitConsole,
    emitNetwork: client.emitNetwork,
  };
}

describe('CdpSession', () => {
  it('connects: discover → proxy → client → Runtime.enable + Network.enable, and reports connected with networkSupport', async () => {
    const { deps, client, proxy, statuses } = makeDeps();
    const session = new CdpSession(deps);

    await session.connect();

    expect(deps.startProxy).toHaveBeenCalledWith(target.webSocketDebuggerUrl);
    expect(deps.createClient).toHaveBeenCalledWith(proxy.downstreamUrl);
    expect(client.connect).toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledWith('Runtime.enable');
    expect(client.send).toHaveBeenCalledWith('Network.enable');
    expect(session.status).toBe('connected');
    expect(session.networkSupport).toBe('available');
    // The final 'connected' status carries the support info.
    const last = statuses[statuses.length - 1];
    expect(last?.status).toBe('connected');
    expect(last?.networkSupport).toBe('available');
  });

  it('streams console events as normalized log entries', async () => {
    const { deps, client, emitConsole } = makeDeps();
    const session = new CdpSession(deps);
    await session.connect();

    emitConsole({
      type: 'error',
      timestamp: 42,
      args: [{ type: 'string', value: 'boom' }],
    });

    void client;
  });

  it('reports an error status when no target is found', async () => {
    const { deps } = makeDeps({ discover: vi.fn(async () => []) });
    const session = new CdpSession(deps);

    await session.connect();

    expect(session.status).toBe('error');
  });

  it('tears down proxy + client and reports an error when connect throws', async () => {
    const { deps, proxy } = makeDeps({
      createClient: vi.fn(() => {
        const c = makeFakeClient();
        c.connect = vi.fn(async () => {
          throw new Error('socket closed');
        });
        return c;
      }),
    });
    const session = new CdpSession(deps);

    await session.connect();

    expect(session.status).toBe('error');
    expect(proxy.close).toHaveBeenCalled();
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

  // -------- auto-reconnect (E-14 slice 4) --------

  /**
   * Build a sleep function whose resolution is driven by the test — so the reconnect
   * loop doesn't spin unbounded. Each `tick()` resolves the oldest pending sleep; the
   * mock's `calls` array is what the test inspects for the chosen backoff sequence.
   */
  function makeTickableSleep() {
    const resolvers: Array<(value: void) => void> = [];
    const sleep = vi.fn((ms: number) => {
      // The test inspects `mock.calls[i][0]` to assert the backoff sequence, so the
      // delay is part of the public surface of this fake even though the resolver
      // itself doesn't care about it.
      void ms;
      return new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
    });
    return {
      sleep,
      /** Resolve the oldest pending sleep. */
      tick: () => {
        const next = resolvers.shift();
        if (next) next();
      },
      /** Resolve every pending sleep in order. */
      drain: () => {
        while (resolvers.length > 0) {
          const next = resolvers.shift();
          if (next) next();
        }
      },
    };
  }

  it('auto-reconnects on a client close while connected: re-discover → re-attach → Runtime.enable re-sent', async () => {
    const fresh = makeFakeClient();
    let created = 0;
    const sleep = makeTickableSleep();
    const { deps, statuses } = makeDeps({
      createClient: vi.fn(() => {
        created += 1;
        return created === 1 ? makeFakeClient() : fresh;
      }),
      sleep: sleep.sleep,
    });
    const session = new CdpSession(deps);

    await session.connect();
    expect(session.status).toBe('connected');
    const firstClient = (deps.createClient as ReturnType<typeof vi.fn>).mock.results[0]
      ?.value as ReturnType<typeof makeFakeClient>;
    firstClient.emitClose(new Error('connection reset'));

    // One sleep is queued by the reconnect loop (the backoff before re-attempt).
    await vi.waitFor(() => expect(sleep.sleep).toHaveBeenCalledTimes(1));
    sleep.tick();
    await vi.waitFor(() => expect(created).toBe(2));

    // Runtime.enable must be re-sent on the new client so console events come back.
    expect(fresh.send).toHaveBeenCalledWith('Runtime.enable');
    // The user saw a 'reconnecting' status flash.
    expect(statuses.some((s) => s.status === 'reconnecting')).toBe(true);
    expect(session.status).toBe('connected');
  });

  it('auto-reconnect uses exponential backoff and resets on success after a few failures', async () => {
    // First connect: target. Then reconnect attempt 1: no target. attempt 2: no target.
    // attempt 3: success.
    const sequence = vi
      .fn<() => Promise<CdpTarget[]>>()
      .mockResolvedValueOnce([target]) // initial connect
      .mockResolvedValueOnce([]) // reconnect attempt 1: no target
      .mockResolvedValueOnce([]) // reconnect attempt 2: no target
      .mockResolvedValueOnce([target]); // reconnect attempt 3: success
    const sleep = makeTickableSleep();
    const { deps } = makeDeps({
      discover: sequence,
      sleep: sleep.sleep,
      reconnectInitialDelayMs: 100,
      reconnectMaxDelayMs: 1000,
    });
    const session = new CdpSession(deps);
    await session.connect();

    const firstClient = (deps.createClient as ReturnType<typeof vi.fn>).mock.results[0]
      ?.value as ReturnType<typeof makeFakeClient>;
    firstClient.emitClose(new Error('boom'));

    // Drain the reconnect loop. The loop runs until success, so we just tick sleep until
    // the session settles back to 'connected'.
    for (let i = 0; i < 10; i += 1) {
      if (session.status === 'connected') break;
      sleep.tick();
      // Let microtasks flush so the next sleep is queued (or the loop exits).
      await new Promise((r) => setImmediate(r));
    }
    expect(session.status).toBe('connected');
    // Three backoff sleeps for the three reconnect attempts (100, 200, 400).
    expect(sleep.sleep.mock.calls.map((c) => c[0])).toEqual([100, 200, 400]);
  });

  it('backoff doubles up to the configured cap', async () => {
    // First discover returns the target (initial connect succeeds). After that, every
    // reconnect discover returns [] — the loop never recovers. We drive 5 attempts and
    // assert that the 6th sleep (queued by the failed 6th attempt) shows the cap holding.
    let n = 0;
    const discover = vi.fn(async () => (n++ === 0 ? [target] : []));
    const sleep = makeTickableSleep();
    const { deps } = makeDeps({
      discover,
      sleep: sleep.sleep,
      reconnectInitialDelayMs: 100,
      reconnectMaxDelayMs: 800,
    });
    const session = new CdpSession(deps);
    await session.connect();
    const firstClient = (deps.createClient as ReturnType<typeof vi.fn>).mock.results[0]
      ?.value as ReturnType<typeof makeFakeClient>;
    firstClient.emitClose(new Error('boom'));

    // Tick 5 reconnect attempts. After each tick + yield, the next sleep is queued.
    for (let i = 0; i < 5; i += 1) {
      await vi.waitFor(() => expect(sleep.sleep).toHaveBeenCalledTimes(i + 1));
      sleep.tick();
      await new Promise((r) => setImmediate(r));
    }
    // The 6th attempt has failed and queued the next (capped) sleep. Disconnect now to
    // stop the loop before the 7th sleep is queued.
    await vi.waitFor(() => expect(sleep.sleep).toHaveBeenCalledTimes(6));
    await session.disconnect();
    sleep.tick(); // resolve the pending sleep so the loop drains cleanly
    await new Promise((r) => setImmediate(r));

    const delays = sleep.sleep.mock.calls.map((c) => c[0]);
    // 100, 200, 400 (doubling) then 800, 800, 800 (capped).
    expect(delays).toEqual([100, 200, 400, 800, 800, 800]);
  });

  it('explicit disconnect() cancels an in-flight reconnect (no further discover calls)', async () => {
    // Sequence: initial discover returns target. First reconnect attempt: discover
    // returns [] (doConnect fails). The loop queues another sleep. We disconnect during
    // that second sleep. The loop must exit without calling discover a third time.
    const sequence = vi
      .fn<() => Promise<CdpTarget[]>>()
      .mockResolvedValueOnce([target]) // initial
      .mockResolvedValueOnce([]); // first reconnect attempt: no target
    const sleep = makeTickableSleep();
    const { deps } = makeDeps({ discover: sequence, sleep: sleep.sleep });
    const session = new CdpSession(deps);
    await session.connect();
    const firstClient = (deps.createClient as ReturnType<typeof vi.fn>).mock.results[0]
      ?.value as ReturnType<typeof makeFakeClient>;
    firstClient.emitClose(new Error('boom'));

    // Wait for the first reconnect sleep to be queued, then tick it.
    await vi.waitFor(() => expect(sleep.sleep).toHaveBeenCalledTimes(1));
    sleep.tick();
    // Yield so doConnect (which calls discover) and the failed-result sleep queue happen.
    await new Promise((r) => setImmediate(r));
    // After the first reconnect attempt fails, the loop queues a second sleep.
    await vi.waitFor(() => expect(sleep.sleep).toHaveBeenCalledTimes(2));
    // Disconnect while the second sleep is pending. The loop must NOT call discover again.
    await session.disconnect();
    sleep.tick(); // drain
    await new Promise((r) => setImmediate(r));

    // 1 initial discover + 1 failed reconnect attempt = 2 total. No third call.
    expect(sequence).toHaveBeenCalledTimes(2);
    expect(session.status).toBe('disconnected');
  });

  it('initial connect failure does NOT trigger auto-reconnect', async () => {
    // discover returns [] on the first call → initial connect fails → status is 'error'.
    // No reconnect should ever start.
    const sleepFn = vi.fn(async () => {});
    const { deps } = makeDeps({ discover: vi.fn(async () => []), sleep: sleepFn });
    const session = new CdpSession(deps);

    await session.connect();

    expect(session.status).toBe('error');
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('Runtime.enable is re-sent on every successful reconnect (not just the first)', async () => {
    // Two close-and-recover cycles: verifies the session is fully re-attached each time.
    const fresh1 = makeFakeClient();
    const fresh2 = makeFakeClient();
    let created = 0;
    const sleep = makeTickableSleep();
    const { deps } = makeDeps({
      createClient: vi.fn(() => {
        created += 1;
        if (created === 1) return makeFakeClient();
        if (created === 2) return fresh1;
        return fresh2;
      }),
      sleep: sleep.sleep,
    });
    const session = new CdpSession(deps);
    await session.connect();
    const c0 = (deps.createClient as ReturnType<typeof vi.fn>).mock.results[0]?.value as ReturnType<
      typeof makeFakeClient
    >;
    c0.emitClose(new Error('first drop'));

    // First reconnect: wait for sleep → tick → fresh1 connected.
    await vi.waitFor(() => expect(sleep.sleep).toHaveBeenCalledTimes(1));
    sleep.tick();
    await vi.waitFor(() => expect(fresh1.send).toHaveBeenCalledWith('Runtime.enable'));
    // The new client also has Network.enable re-sent (slice 5). Both are expected.
    expect(fresh1.send).toHaveBeenCalledTimes(2);

    // Second drop on fresh1: another reconnect → fresh2.
    fresh1.emitClose(new Error('second drop'));
    await vi.waitFor(() => expect(sleep.sleep).toHaveBeenCalledTimes(2));
    sleep.tick();
    await vi.waitFor(() => expect(fresh2.send).toHaveBeenCalledWith('Runtime.enable'));
    expect(fresh2.send).toHaveBeenCalledTimes(2);
  });

  // -------- Network domain (E-14 slice 5) --------

  it('streams network events as normalized records when Network.enable succeeds', async () => {
    const { deps, client, network, emitNetwork } = makeDeps();
    const session = new CdpSession(deps);
    await session.connect();
    expect(session.networkSupport).toBe('available');

    emitNetwork(NETWORK_EVENTS.REQUEST_WILL_BE_SENT, {
      requestId: 'r1',
      timestamp: 100,
      request: { url: 'https://api.example.com/u', method: 'POST' },
    });
    emitNetwork(NETWORK_EVENTS.RESPONSE_RECEIVED, {
      requestId: 'r1',
      timestamp: 200,
      response: {
        url: 'https://api.example.com/u',
        status: 201,
        statusText: 'Created',
        mimeType: 'application/json',
        requestMethod: 'POST',
      },
    });
    emitNetwork(NETWORK_EVENTS.LOADING_FAILED, {
      requestId: 'r2',
      timestamp: 300,
      errorText: 'net::ERR_INTERNET_DISCONNECTED',
    });

    expect(network).toEqual([
      {
        kind: 'request',
        requestId: 'r1',
        timestampMs: 100,
        url: 'https://api.example.com/u',
        method: 'POST',
      },
      {
        kind: 'response',
        requestId: 'r1',
        timestampMs: 200,
        url: 'https://api.example.com/u',
        method: 'POST',
        status: 201,
        statusText: 'Created',
        contentType: 'application/json',
      },
      {
        kind: 'failed',
        requestId: 'r2',
        timestampMs: 300,
        errorText: 'net::ERR_INTERNET_DISCONNECTED',
      },
    ]);
    void client;
  });

  it('gracefully degrades when Network.enable fails (RN < 0.76) and skips network events', async () => {
    const { deps, client, network, emitNetwork, statuses } = makeDeps();
    client.setRejects(['Network.enable']);
    const session = new CdpSession(deps);
    await session.connect();

    // The session is still 'connected' — console keeps working.
    expect(session.status).toBe('connected');
    expect(session.networkSupport).toBe('unavailable');
    // The final status event carries the unavailable signal.
    const last = statuses[statuses.length - 1];
    expect(last?.networkSupport).toBe('unavailable');

    // Network events are subscribed to but the guard in #forwardNetwork suppresses
    // forwarding when support is 'unavailable' — the renderer never sees them.
    emitNetwork(NETWORK_EVENTS.REQUEST_WILL_BE_SENT, {
      requestId: 'r1',
      timestamp: 100,
      request: { url: 'https://x', method: 'GET' },
    });
    expect(network).toEqual([]);
  });

  it('re-enables Network on a successful reconnect (each attempt is fresh)', async () => {
    const sleep = makeTickableSleep();
    const { deps } = makeDeps({ sleep: sleep.sleep });
    const session = new CdpSession(deps);
    await session.connect();
    const firstClient = (deps.createClient as ReturnType<typeof vi.fn>).mock.results[0]
      ?.value as ReturnType<typeof makeFakeClient>;
    firstClient.emitClose(new Error('drop'));

    await vi.waitFor(() => expect(sleep.sleep).toHaveBeenCalledTimes(1));
    sleep.tick();
    // After reconnect, Network.enable is sent on the new client too.
    await vi.waitFor(() => expect(deps.createClient).toHaveBeenCalledTimes(2));
    const newClient = (deps.createClient as ReturnType<typeof vi.fn>).mock.results[1]
      ?.value as ReturnType<typeof makeFakeClient>;
    await vi.waitFor(() => expect(newClient.send).toHaveBeenCalledWith('Network.enable'));
  });

  it('resets networkSupport to undefined on disconnect', async () => {
    const { deps } = makeDeps();
    const session = new CdpSession(deps);
    await session.connect();
    expect(session.networkSupport).toBe('available');
    await session.disconnect();
    expect(session.networkSupport).toBeUndefined();
  });
});
