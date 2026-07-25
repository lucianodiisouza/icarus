import { ManagedProcess } from './managed-process.js';
import type { ProcessSpec } from './types.js';

/**
 * Owns every child process Icarus spawns and guarantees teardown (G-2, TR-2). Nothing
 * else in the codebase may call `child_process` directly — everything goes through here,
 * so the "no orphans" guarantee holds in one place. Electron-free (ADR-0002); the app
 * wires `disposeAll()` to Electron's `will-quit` and to SIGINT/SIGTERM.
 */
export class ProcessManager {
  readonly #processes = new Map<string, ManagedProcess>();

  /** Spawn and register a supervised process. Ids must be unique. */
  spawn(spec: ProcessSpec): ManagedProcess {
    if (spec.id !== undefined && this.#processes.has(spec.id)) {
      throw new Error(`Process id already in use: ${spec.id}`);
    }
    const proc = new ManagedProcess(spec);
    this.#processes.set(proc.id, proc);
    // Stop tracking once it exits so the registry doesn't grow unbounded.
    proc.onExit(() => this.#processes.delete(proc.id));
    return proc;
  }

  get(id: string): ManagedProcess | undefined {
    return this.#processes.get(id);
  }

  /** Currently-tracked (not-yet-exited) processes. */
  list(): ManagedProcess[] {
    return [...this.#processes.values()];
  }

  /**
   * Stop every tracked process, escalating to a forced kill as needed. Idempotent and
   * safe to call on teardown. Resolves once all have exited.
   */
  async disposeAll(): Promise<void> {
    const all = this.list();
    await Promise.all(all.map((proc) => proc.stop()));
    this.#processes.clear();
  }
}
