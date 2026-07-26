import { ManagedProcess } from './managed-process.js';
import type { OrphanRegistry } from './orphan-registry.js';
import type { ProcessSpec } from './types.js';

export interface ProcessManagerOptions {
  /**
   * Optional cross-launch orphan registry (TD-11). When provided, each POSIX-group spawn is
   * persisted and cleared on exit, so a survivor of a hard crash can be reaped next launch.
   */
  readonly registry?: OrphanRegistry;
}

/**
 * Owns every child process Icarus spawns and guarantees teardown (G-2, TR-2). Nothing
 * else in the codebase may call `child_process` directly — everything goes through here,
 * so the "no orphans" guarantee holds in one place. Electron-free (ADR-0002); the app
 * wires `disposeAll()` to Electron's `will-quit` and to SIGINT/SIGTERM.
 */
export class ProcessManager {
  readonly #processes = new Map<string, ManagedProcess>();
  readonly #registry: OrphanRegistry | undefined;

  constructor(options: ProcessManagerOptions = {}) {
    this.#registry = options.registry;
  }

  /** Spawn and register a supervised process. Ids must be unique. */
  spawn(spec: ProcessSpec): ManagedProcess {
    if (spec.id !== undefined && this.#processes.has(spec.id)) {
      throw new Error(`Process id already in use: ${spec.id}`);
    }
    const proc = new ManagedProcess(spec);
    this.#processes.set(proc.id, proc);
    this.#track(proc);
    // Stop tracking once it exits so the registry doesn't grow unbounded.
    proc.onExit(() => {
      this.#processes.delete(proc.id);
      if (proc.pid !== undefined) this.#registry?.onExit(proc.pid);
    });
    return proc;
  }

  /**
   * Persist the spawn for cross-launch reaping. Only POSIX detached spawns form their own
   * process group (pgid === pid); on Windows there's no group to record (NG-7), so skip.
   */
  #track(proc: ManagedProcess): void {
    if (this.#registry === undefined || process.platform === 'win32') return;
    const pid = proc.pid;
    if (pid === undefined) return;
    this.#registry.onSpawn({ pid, pgid: pid, command: proc.command });
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
