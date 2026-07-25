import { ManagedProcess } from '../process/managed-process.js';
import { ProcessManager } from '../process/process-manager.js';
import type { ExitInfo } from '../process/types.js';

/**
 * Native log capture from a booted iOS simulator (E-10). Spawns
 *   xcrun simctl spawn <udid> log stream --level=debug --style=compact
 * and streams each stdout line as an emitted event. The stream is indefinite
 * (simctl keeps streaming until the process is killed), so the lifetime is
 * tied to the source's \`stop()\` — no need for a ready signal.
 *
 * Per NG-7 we are macOS-first; Android via \`adb logcat\` is a follow-up that
 * slots into the same \`NativeLogSourceLike\` interface. We don't import
 * \`react-native\` here so the boundary is clean (ADR-0002).
 */
export interface NativeLogSourceLike {
  /** Fired for every line simctl emits on stdout. */
  onLine(handler: (line: string) => void): () => void;
  /** True if the underlying process is alive. */
  isRunning(): boolean;
  /** Stop the stream. Idempotent. Resolves once the process has exited. */
  stop(): Promise<void>;
}

export interface NativeLogExecutor {
  /** Spawn simctl and return the underlying ManagedProcess. */
  spawn(udid: string, processes: ProcessManager): ManagedProcess;
}

const DEFAULT_EXECUTOR: NativeLogExecutor = {
  spawn: (udid, processes) =>
    processes.spawn({
      id: `simctl-log-stream-${udid}`,
      command: 'xcrun',
      args: ['simctl', 'spawn', udid, 'log', 'stream', '--level=debug', '--style=compact'],
      shutdown: { signal: 'SIGTERM', graceMs: 3000 },
    }),
};

/**
 * Parse a single simctl log line. The compact style is roughly:
 *   2026-07-25 12:34:56.789 subsystem category <level>: message
 * We only need to surface the level + message back; the timestamp is captured
 * at fan-in time. Returns null on lines that don't match.
 */
export function parseSyslogLine(line: string): { level: string; text: string } | null {
  // Match a "<level>:" token anywhere after the timestamp; everything after is the message.
  const m = /\b(log|info|debug|notice|warn|warning|error|err|fault)\b\s*:/i.exec(line);
  if (!m) return null;
  const level = m[1]?.toLowerCase() ?? 'log';
  const idx = (m.index ?? 0) + m[0].length;
  const text = line.slice(idx).trim();
  return { level, text };
}

export class IosSyslogSource implements NativeLogSourceLike {
  readonly #process: ManagedProcess;
  readonly #lineHandlers = new Set<(line: string) => void>();
  #stopped = false;

  constructor(
    udid: string,
    processes: ProcessManager,
    executor: NativeLogExecutor = DEFAULT_EXECUTOR,
  ) {
    this.#process = executor.spawn(udid, processes);
    this.#process.onLine((event) => {
      // Forward the text to all subscribers. We only watch stdout (simctl writes the
      // stream to stdout, not stderr).
      if (event.stream === 'stdout') {
        for (const h of [...this.#lineHandlers]) h(event.text);
      }
    });
  }

  onLine(handler: (line: string) => void): () => void {
    this.#lineHandlers.add(handler);
    return () => {
      this.#lineHandlers.delete(handler);
    };
  }

  isRunning(): boolean {
    return !this.#stopped && this.#process.state !== 'exited' && this.#process.state !== 'errored';
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#lineHandlers.clear();
    try {
      await this.#process.stop();
    } catch {
      /* swallow — stop is best-effort during teardown */
    }
  }
}

/** A trivial in-memory source, for tests. */
export class InMemoryNativeLogSource implements NativeLogSourceLike {
  #handlers = new Set<(line: string) => void>();
  #running = false;
  start(): void {
    this.#running = true;
  }
  emit(line: string): void {
    for (const h of [...this.#handlers]) h(line);
  }
  onLine(handler: (line: string) => void): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }
  isRunning(): boolean {
    return this.#running;
  }
  async stop(): Promise<void> {
    this.#running = false;
  }
}

export type { ExitInfo };
