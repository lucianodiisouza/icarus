import type { z } from 'zod';

/**
 * A typed, allowlist IPC router (ADR-0004/0006). Every channel must be explicitly
 * registered with a runtime input schema; `dispatch` validates input at the boundary and
 * rejects unknown channels and invalid payloads. This class is Electron-free on purpose so
 * it is unit-testable without a desktop shell — the Electron `ipcMain` binding is a thin
 * adapter over `dispatch` (see main/index.ts).
 */

export type IpcErrorCode = 'unknown_channel' | 'invalid_input' | 'handler_error';

export class IpcError extends Error {
  readonly code: IpcErrorCode;
  readonly channel: string;

  constructor(code: IpcErrorCode, channel: string, message: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
    this.channel = channel;
  }
}

interface Entry {
  readonly schema: z.ZodType<unknown>;
  readonly handler: (input: unknown) => Promise<unknown>;
}

export class IpcRouter {
  readonly #entries = new Map<string, Entry>();

  /**
   * Register a handler for a channel. Registering the same channel twice is a programmer
   * error and throws (we never silently overwrite a boundary handler).
   */
  register<I, O>(channel: string, schema: z.ZodType<I>, handler: (input: I) => Promise<O>): void {
    if (this.#entries.has(channel)) {
      throw new IpcError('handler_error', channel, `Channel already registered: ${channel}`);
    }
    this.#entries.set(channel, {
      schema: schema as z.ZodType<unknown>,
      handler: handler as (input: unknown) => Promise<unknown>,
    });
  }

  /** The set of registered channels (for diagnostics/tests). */
  channels(): string[] {
    return [...this.#entries.keys()];
  }

  /**
   * Validate and dispatch a request. Throws `IpcError` for an unknown channel or invalid
   * input; wraps a throwing handler as `handler_error` (never leaks a raw stack across the
   * boundary).
   */
  async dispatch(channel: string, rawInput: unknown): Promise<unknown> {
    const entry = this.#entries.get(channel);
    if (!entry) {
      throw new IpcError('unknown_channel', channel, `Unknown IPC channel: ${channel}`);
    }

    const parsed = entry.schema.safeParse(rawInput);
    if (!parsed.success) {
      throw new IpcError(
        'invalid_input',
        channel,
        `Invalid input for ${channel}: ${parsed.error.message}`,
      );
    }

    try {
      return await entry.handler(parsed.data);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new IpcError('handler_error', channel, `Handler for ${channel} failed: ${detail}`);
    }
  }
}
