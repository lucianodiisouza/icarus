import { afterEach, describe, expect, it, vi } from 'vitest';
import { CdpClient, CdpError, httpOriginFromWsUrl } from './cdp-client.js';
import type { CdpSocket, CdpSocketFactory } from './types.js';

/** A controllable fake socket that records sent frames and lets tests drive events. */
class FakeSocket implements CdpSocket {
  readonly sent: string[] = [];
  closed = false;
  #open?: () => void;
  #message?: (data: string) => void;
  #close?: () => void;
  #error?: (error: Error) => void;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.#close?.();
  }
  onOpen(handler: () => void): void {
    this.#open = handler;
  }
  onMessage(handler: (data: string) => void): void {
    this.#message = handler;
  }
  onClose(handler: () => void): void {
    this.#close = handler;
  }
  onError(handler: (error: Error) => void): void {
    this.#error = handler;
  }

  emitOpen(): void {
    this.#open?.();
  }
  emitMessage(obj: unknown): void {
    this.#message?.(JSON.stringify(obj));
  }
  emitRaw(data: string): void {
    this.#message?.(data);
  }
  emitError(error: Error): void {
    this.#error?.(error);
  }

  lastSent(): { id: number; method: string; params: unknown } {
    const raw = this.sent.at(-1);
    if (!raw) throw new Error('nothing sent');
    return JSON.parse(raw);
  }
}

function setup(url = 'ws://localhost:8081/inspector/debug?device=d&page=1') {
  const socket = new FakeSocket();
  let capturedOrigin = '';
  const factory: CdpSocketFactory = (_url, opts) => {
    capturedOrigin = opts.origin;
    return socket;
  };
  const client = new CdpClient(url, { socketFactory: factory });
  return { socket, client, getOrigin: () => capturedOrigin };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('httpOriginFromWsUrl', () => {
  it('derives an http origin from a ws url', () => {
    expect(httpOriginFromWsUrl('ws://localhost:8081/x')).toBe('http://localhost:8081');
    expect(httpOriginFromWsUrl('wss://host:9/y')).toBe('https://host:9');
  });
});

describe('CdpClient', () => {
  it('sends the Origin CSRF header derived from the ws url', () => {
    const { getOrigin } = setup();
    expect(getOrigin()).toBe('http://localhost:8081');
  });

  it('connect resolves on open', async () => {
    const { socket, client } = setup();
    const p = client.connect();
    socket.emitOpen();
    await expect(p).resolves.toBeUndefined();
  });

  it('send resolves with the result for the matching id', async () => {
    const { socket, client } = setup();
    void client.connect();
    socket.emitOpen();

    const p = client.send('Runtime.evaluate', { expression: '1+1' });
    const { id, method } = socket.lastSent();
    expect(method).toBe('Runtime.evaluate');
    socket.emitMessage({ id, result: { value: 2 } });

    expect(await p).toEqual({ value: 2 });
  });

  it('send rejects with a CdpError on a protocol error', async () => {
    const { socket, client } = setup();
    void client.connect();
    socket.emitOpen();

    const p = client.send('Network.enable');
    const { id } = socket.lastSent();
    socket.emitMessage({ id, error: { code: -32601, message: 'Unsupported' } });

    await expect(p).rejects.toBeInstanceOf(CdpError);
    await expect(p).rejects.toMatchObject({ code: -32601 });
  });

  it('send rejects on timeout (starved connection does not hang forever)', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const client = new CdpClient('ws://localhost:8081/x', {
      socketFactory: () => socket,
      requestTimeoutMs: 500,
    });
    void client.connect();
    socket.emitOpen();

    const p = client.send('Runtime.enable');
    const assertion = expect(p).rejects.toThrow(/timeout after 500ms/);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it('dispatches CDP events to subscribers', () => {
    const { socket, client } = setup();
    void client.connect();
    socket.emitOpen();

    const seen: unknown[] = [];
    client.on('Runtime.consoleAPICalled', (params) => seen.push(params));
    socket.emitMessage({ method: 'Runtime.consoleAPICalled', params: { type: 'log' } });

    expect(seen).toEqual([{ type: 'log' }]);
  });

  it('ignores non-JSON frames', () => {
    const { socket, client } = setup();
    void client.connect();
    socket.emitOpen();
    expect(() => socket.emitRaw('not json')).not.toThrow();
  });

  it('rejects pending requests when the socket closes', async () => {
    const { socket, client } = setup();
    void client.connect();
    socket.emitOpen();
    const p = client.send('Runtime.enable');
    socket.close();
    await expect(p).rejects.toThrow(/closed/);
  });

  it('onClose fires once when the socket closes, with the close reason', () => {
    const { socket, client } = setup();
    void client.connect();
    socket.emitOpen();

    const seen: Error[] = [];
    client.onClose((reason) => seen.push(reason));
    socket.close();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.message).toMatch(/closed/);
  });

  it('onClose fires exactly once even on subsequent sends / close calls', async () => {
    const { socket, client } = setup();
    void client.connect();
    socket.emitOpen();

    let count = 0;
    client.onClose(() => count++);
    socket.close();
    // A second close is a no-op (the socket is already gone), and the handler should not
    // be called again — the client is in a terminal state.
    client.close();
    await expect(client.send('Runtime.enable')).rejects.toThrow();

    expect(count).toBe(1);
  });

  it('onClose handlers are isolated — a throwing handler does not skip siblings', () => {
    const { socket, client } = setup();
    void client.connect();
    socket.emitOpen();

    const seen: string[] = [];
    client.onClose(() => {
      throw new Error('boom');
    });
    client.onClose((reason) => seen.push(reason.message));
    socket.close();

    expect(seen).toHaveLength(1);
  });

  it('onClose unsubscribe stops further delivery', () => {
    const { socket, client } = setup();
    void client.connect();
    socket.emitOpen();

    let calls = 0;
    const off = client.onClose(() => calls++);
    off();
    socket.close();

    expect(calls).toBe(0);
  });
});
