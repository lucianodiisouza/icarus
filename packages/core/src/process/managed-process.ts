import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventBus } from '../event-bus/event-bus.js';
import type { Unsubscribe } from '../event-bus/event-bus.js';
import { LineStream } from './line-stream.js';
import type { ExitInfo, LineEvent, ProcessSpec, ProcessState, StopOptions } from './types.js';

const DEFAULT_GRACE_MS = 5000;

type ManagedProcessEvents = {
  state: ProcessState;
  line: LineEvent;
  exit: ExitInfo;
};

/**
 * A single supervised OS process. Spawned in its own process group (POSIX `detached`) so
 * that `stop()` can signal the whole group — killing the process AND its children (e.g.
 * Metro's workers), the #1 source of orphans (TR-2). Shutdown escalates
 * graceful-signal → grace period → SIGKILL. Never depends on Electron (ADR-0002).
 */
export class ManagedProcess {
  readonly id: string;
  readonly stdout = new LineStream();
  readonly stderr = new LineStream();

  readonly #spec: ProcessSpec;
  readonly #bus = new EventBus<ManagedProcessEvents>();
  readonly #child: ChildProcess;
  #state: ProcessState = 'starting';
  #exit: ExitInfo | null = null;
  #ready = false;

  readonly #readyPromise: Promise<void>;
  #resolveReady!: () => void;
  #rejectReady!: (err: Error) => void;

  readonly #exitPromise: Promise<ExitInfo>;
  #resolveExit!: (info: ExitInfo) => void;

  constructor(spec: ProcessSpec) {
    this.#spec = spec;
    this.id = spec.id ?? randomUUID();

    this.#readyPromise = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    this.#exitPromise = new Promise((resolve) => {
      this.#resolveExit = resolve;
    });

    this.#child = spawn(spec.command, [...(spec.args ?? [])], {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      // Own process group so we can signal the whole tree on stop (POSIX). On Windows we
      // fall back to a taskkill tree in signalTree().
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.#wire();
  }

  get state(): ProcessState {
    return this.#state;
  }

  get pid(): number | undefined {
    return this.#child.pid;
  }

  /** The command this process was spawned with (diagnostics; e.g. orphan-registry records). */
  get command(): string {
    return this.#spec.command;
  }

  /** Resolves when the process is ready (readyWhen matched) or running (if no probe). */
  waitReady(): Promise<void> {
    return this.#readyPromise;
  }

  /** Resolves when the process has exited (for any reason). */
  waitExit(): Promise<ExitInfo> {
    return this.#exitPromise;
  }

  onStateChange(handler: (state: ProcessState) => void): Unsubscribe {
    return this.#bus.on('state', handler);
  }

  onLine(handler: (event: LineEvent) => void): Unsubscribe {
    return this.#bus.on('line', handler);
  }

  onExit(handler: (info: ExitInfo) => void): Unsubscribe {
    return this.#bus.on('exit', handler);
  }

  /**
   * Stop the process: graceful signal to the group → wait graceMs → SIGKILL. Idempotent;
   * if already exited, resolves with the recorded ExitInfo.
   */
  async stop(options: StopOptions = {}): Promise<ExitInfo> {
    if (this.#exit) return this.#exit;
    if (this.#state === 'stopping') return this.#exitPromise;

    this.#setState('stopping');
    const signal = options.signal ?? this.#spec.shutdown?.signal ?? 'SIGTERM';
    const graceMs = options.graceMs ?? this.#spec.shutdown?.graceMs ?? DEFAULT_GRACE_MS;

    this.#signalTree(signal);

    const forced = await this.#raceExitWithGrace(graceMs);
    if (forced) this.#signalTree('SIGKILL');

    const info = await this.#exitPromise;
    return info.forced === forced ? info : { ...info, forced: info.forced || forced };
  }

  #wire(): void {
    this.#child.stdout?.setEncoding('utf8');
    this.#child.stderr?.setEncoding('utf8');
    this.stdout.onLine((line) => this.#onLine('stdout', line));
    this.stderr.onLine((line) => this.#onLine('stderr', line));
    this.#child.stdout?.on('data', (chunk: string) => this.stdout.push(chunk));
    this.#child.stderr?.on('data', (chunk: string) => this.stderr.push(chunk));

    this.#child.on('spawn', () => {
      if (this.#state === 'starting') this.#setState('running');
      if (!this.#spec.readyWhen) this.#markReady();
    });

    this.#child.on('error', (err: Error) => {
      this.#setState('errored');
      this.stdout.close();
      this.stderr.close();
      if (!this.#ready) this.#rejectReady(err);
      this.#finishExit({ code: null, signal: null, forced: false });
    });

    this.#child.on('exit', (code, signal) => {
      this.stdout.close();
      this.stderr.close();
      const info: ExitInfo = { code, signal, forced: false };
      if (!this.#ready) {
        this.#rejectReady(
          new Error(`Process ${this.id} exited (code=${code}, signal=${signal}) before ready`),
        );
      }
      if (this.#state !== 'stopping') this.#setState('exited');
      this.#finishExit(info);
    });
  }

  #onLine(stream: 'stdout' | 'stderr', line: string): void {
    this.#bus.emit('line', { stream, text: line });
    if (!this.#ready && this.#spec.readyWhen?.(line)) this.#markReady();
  }

  #markReady(): void {
    if (this.#ready) return;
    this.#ready = true;
    if (this.#state === 'running' || this.#state === 'starting') this.#setState('ready');
    this.#resolveReady();
  }

  #setState(state: ProcessState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#bus.emit('state', state);
  }

  #finishExit(info: ExitInfo): void {
    if (this.#exit) return;
    if (this.#state !== 'errored') this.#setState('exited');
    this.#exit = info;
    this.#bus.emit('exit', info);
    this.#resolveExit(info);
  }

  /** Returns true if the grace period elapsed without exit (i.e. a force kill is needed). */
  #raceExitWithGrace(graceMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(true), graceMs);
      void this.#exitPromise.then(() => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  /** Signal the process's whole group/tree so children die too. */
  #signalTree(signal: NodeJS.Signals): void {
    const pid = this.#child.pid;
    if (pid === undefined) return;
    if (process.platform === 'win32') {
      // Best-effort tree kill on Windows (deferred-parity, NG-7).
      spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
      return;
    }
    try {
      process.kill(-pid, signal); // negative pid → the whole process group
    } catch {
      try {
        process.kill(pid, signal); // group gone; try the process directly
      } catch {
        /* already dead */
      }
    }
  }
}
