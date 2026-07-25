/**
 * Minimal structured logger for Icarus's own plumbing (principle: observable core).
 * Emits structured records to a sink so tests can assert on them and the app can route
 * them wherever it wants. Electron-free (ADR-0002).
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly time: string;
  readonly data?: Record<string, unknown>;
}

export type LogSink = (record: LogRecord) => void;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  readonly scope: string;
  readonly minLevel?: LogLevel;
  readonly sink?: LogSink;
  readonly now?: () => Date;
}

/**
 * The default sink writes a compact line to the appropriate console stream. Callers that
 * want structured routing pass their own sink.
 */
export const consoleSink: LogSink = (r) => {
  const line = `${r.time} ${r.level.toUpperCase().padEnd(5)} [${r.scope}] ${r.message}`;
  const stream = r.level === 'error' || r.level === 'warn' ? console.error : console.log;
  if (r.data) stream(line, r.data);
  else stream(line);
};

export class Logger {
  readonly #scope: string;
  readonly #minLevel: LogLevel;
  readonly #sink: LogSink;
  readonly #now: () => Date;

  constructor(options: LoggerOptions) {
    this.#scope = options.scope;
    this.#minLevel = options.minLevel ?? 'info';
    this.#sink = options.sink ?? consoleSink;
    this.#now = options.now ?? (() => new Date());
  }

  /** Derive a child logger with a nested scope, inheriting sink/level. */
  child(scope: string): Logger {
    return new Logger({
      scope: `${this.#scope}:${scope}`,
      minLevel: this.#minLevel,
      sink: this.#sink,
      now: this.#now,
    });
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.#log('debug', message, data);
  }
  info(message: string, data?: Record<string, unknown>): void {
    this.#log('info', message, data);
  }
  warn(message: string, data?: Record<string, unknown>): void {
    this.#log('warn', message, data);
  }
  error(message: string, data?: Record<string, unknown>): void {
    this.#log('error', message, data);
  }

  #log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.#minLevel]) return;
    const record: LogRecord = {
      level,
      scope: this.#scope,
      message,
      time: this.#now().toISOString(),
      ...(data ? { data } : {}),
    };
    this.#sink(record);
  }
}
