import { ProcessManager } from '../process/process-manager.js';
import type { ExitInfo, LineEvent, ProcessState } from '../process/types.js';
import { detectProject, type DetectedProject } from '../detect-project/detect-project.js';

/**
 * Owns the Metro dev-server lifecycle for one project (E-08). Wraps a `ProcessManager`
 * to keep the "no orphans" guarantee (G-2 / TR-2) and exposes a stateful, event-driven
 * surface the desktop app can drive and stream to the renderer.
 *
 * State machine:
 *   idle → starting → (ready | errored) → stopping → exited → idle
 *   ready → errored if the process dies unexpectedly
 *
 * For v1 we launch the same CLI for both bare RN and Expo: modern Expo delegates to
 * `react-native start` under the hood, so the user just sees "Metro is up." The
 * detection is still done so we can label the UI correctly and diverge later if needed
 * (Expo-only tunneling, etc.).
 *
 * The ready probe looks for the line Metro prints when it starts listening:
 *   - `Metro waiting on http://localhost:8081` (most common)
 *   - `Server listening on http://localhost:8081`
 * The captured port is what downstream consumers (E-14's CdpSession) attach to.
 */
export type MetroStatus =
  'idle' | 'starting' | 'ready' | 'stopping' | 'exited' | 'errored' | 'unsupported-project';

export interface MetroLogEvent {
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
  readonly timestampMs: number;
}

/** What a successful start returned to the caller. */
export interface MetroStarted {
  readonly project: DetectedProject;
  readonly port: number | null;
  readonly pid: number | undefined;
}

/**
 * The subset of ManagedProcess the controller depends on. Lets tests inject a fake
 * without standing up a real child process (or even a real ProcessManager). The
 * production path still uses ManagedProcess directly via `DEFAULT_SPAWN`.
 */
export interface MetroProcess {
  readonly pid: number | undefined;
  readonly stdout: { lines(): readonly string[] };
  waitReady(): Promise<void>;
  onLine(handler: (event: LineEvent) => void): () => void;
  onStateChange(handler: (state: ProcessState) => void): () => void;
  onExit(handler: (info: ExitInfo) => void): () => void;
  stop(): Promise<ExitInfo>;
}

export interface MetroControllerDeps {
  readonly processes: ProcessManager;
  /** Injectable spawn override — useful for tests that don't want a real child process. */
  readonly spawn?: (project: DetectedProject) => MetroProcess;
  /** Injectable `now()` for deterministic log timestamps. */
  readonly now?: () => number;
  /**
   * Injectable file reader for project detection. In tests, return a controlled
   * package.json string. Production: defaults to node:fs/promises.readFile.
   */
  readonly readFile?: (path: string) => Promise<string | null>;
}

const READY_LINE = /(?:Metro waiting|Server listening) on .*:(\d+)/;

/** Pure helper: pull a port number out of a Metro "I'm up" line, or null. */
export function extractMetroPort(line: string): number | null {
  const match = READY_LINE.exec(line);
  if (!match) return null;
  const port = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(port) ? port : null;
}

/** Pure helper: the CLI argv for a detected project. */
export function buildMetroCommand(_project: DetectedProject): {
  command: string;
  args: readonly string[];
} {
  // `npx react-native start` works for both bare RN and modern Expo (Expo's CLI delegates
  // to it). If we ever need a project-specific command (e.g. Expo tunnel) we branch here
  // on `_project.kind`.
  void _project;
  return {
    command: 'npx',
    args: ['--yes', 'react-native', 'start'],
  };
}

const DEFAULT_SPAWN = (processes: ProcessManager, project: DetectedProject): MetroProcess => {
  const { command, args } = buildMetroCommand(project);
  // The cast is safe: ManagedProcess implements every method on MetroProcess. The two
  // types aren't bidirectionally assignable because ManagedProcess has private fields
  // (TS treats those as part of the structural shape for compatibility checks), but for
  // the read-only subset we use, the runtime contract is identical.
  return processes.spawn({
    id: `${project.id}-metro`,
    command,
    args,
    cwd: project.cwd,
    // Metro writes its "I'm up" line to stderr (it routes through @react-native-community/cli).
    // We match against BOTH streams just to be safe across versions.
    readyWhen: (line) => extractMetroPort(line) !== null,
    shutdown: { signal: 'SIGTERM', graceMs: 5000 },
  }) as unknown as MetroProcess;
};

export class MetroController {
  readonly #deps: MetroControllerDeps;
  readonly #now: () => number;
  #status: MetroStatus = 'idle';
  #project: DetectedProject | null = null;
  #process: MetroProcess | null = null;
  #port: number | null = null;
  #logHandlers = new Set<(event: MetroLogEvent) => void>();
  #statusHandlers = new Set<(status: MetroStatus) => void>();

  constructor(deps: MetroControllerDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  get status(): MetroStatus {
    return this.#status;
  }

  get project(): DetectedProject | null {
    return this.#project;
  }

  get port(): number | null {
    return this.#port;
  }

  /**
   * Detect a project at `cwd` and start its Metro dev server. Resolves once the process
   * is ready (or rejects on the underlying error). Safe to call once at a time; if a
   * previous run is still alive, it is stopped first.
   */
  async start(cwd: string): Promise<MetroStarted> {
    if (this.#status === 'starting' || this.#status === 'ready') {
      throw new Error(`Metro already ${this.#status}`);
    }
    if (this.#process) {
      await this.#process.stop();
      this.#process = null;
    }
    const project = await detectProject(
      cwd,
      this.#deps.readFile ? { readFile: this.#deps.readFile } : {},
    );
    this.#project = project;
    if (project.kind === 'unknown') {
      this.#setStatus('unsupported-project');
      throw new Error(
        'No React Native / Expo project found at the given path. ' +
          'Make sure package.json has a `react-native` or `expo` dependency.',
      );
    }

    this.#setStatus('starting');
    const proc: MetroProcess = this.#deps.spawn
      ? this.#deps.spawn(project)
      : DEFAULT_SPAWN(this.#deps.processes, project);
    this.#process = proc;
    this.#wire(proc);

    try {
      await proc.waitReady();
      this.#port = extractMetroPort(proc.stdout.lines().at(-1) ?? '') ?? this.#port;
      this.#setStatus('ready');
      const started: MetroStarted = { project, port: this.#port, pid: proc.pid };
      return started;
    } catch (error) {
      this.#setStatus('errored');
      throw error;
    }
  }

  /** Stop Metro. Idempotent; safe to call from a teardown path. */
  async stop(): Promise<void> {
    if (!this.#process) {
      this.#setStatus('idle');
      return;
    }
    this.#setStatus('stopping');
    try {
      await this.#process.stop();
    } finally {
      this.#process = null;
      this.#port = null;
      this.#setStatus('idle');
    }
  }

  onLog(handler: (event: MetroLogEvent) => void): () => void {
    this.#logHandlers.add(handler);
    return () => {
      this.#logHandlers.delete(handler);
    };
  }

  onStatus(handler: (status: MetroStatus) => void): () => void {
    this.#statusHandlers.add(handler);
    return () => {
      this.#statusHandlers.delete(handler);
    };
  }

  #wire(proc: MetroProcess): void {
    proc.onLine((event) => {
      this.#emitLog({ stream: event.stream, text: event.text, timestampMs: this.#now() });
      // Re-evaluate the ready port as lines stream in — the first matching line wins.
      if (this.#port === null) {
        const p = extractMetroPort(event.text);
        if (p !== null) this.#port = p;
      }
    });
    proc.onStateChange((state) => {
      if (state === 'errored') this.#setStatus('errored');
      // 'ready' is set explicitly in start() so the port can be captured alongside.
      // 'stopping' is set explicitly in stop() to avoid races with the controller's own state.
    });
    proc.onExit(() => {
      // Unexpected exit (e.g. process crashed). If we were 'ready' and the user didn't
      // ask for a stop, surface the failure as 'errored' rather than 'exited' — the
      // latter is for a clean user-initiated stop.
      if (this.#status === 'ready' || this.#status === 'starting') {
        this.#setStatus('errored');
      } else if (this.#status !== 'idle') {
        this.#setStatus('exited');
      }
      this.#process = null;
    });
  }

  #setStatus(status: MetroStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    for (const handler of [...this.#statusHandlers]) handler(status);
  }

  #emitLog(event: MetroLogEvent): void {
    for (const handler of [...this.#logHandlers]) handler(event);
  }
}
