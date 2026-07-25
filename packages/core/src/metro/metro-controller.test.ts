import { describe, expect, it, vi } from 'vitest';
import type { ExitInfo, LineEvent, ProcessState } from '../process/types.js';
import type { DetectedProject } from '../detect-project/detect-project.js';
import { MetroController, type MetroLogEvent, type MetroProcess } from './metro-controller.js';
import { buildMetroCommand, extractMetroPort } from './metro-controller.js';

const FIXED_NOW = () => 1_700_000_000_000;

const detectedBareRn: DetectedProject = {
  cwd: '/work/app',
  name: 'myapp',
  kind: 'bare-rn',
  id: 'metro-myapp-/work/app',
};

const detectedExpo: DetectedProject = {
  cwd: '/work/expo',
  name: 'myexpo',
  kind: 'expo',
  id: 'metro-myexpo-/work/expo',
};

/**
 * Fake MetroProcess. The controller only ever reads `pid`, `stdout.lines()`, and
 * subscribes via `onLine` / `onStateChange` / `onExit`. `waitReady()` resolves when
 * the test calls `markReady()`; `stop()` resolves when the test calls `markExit()`.
 */
function makeFakeProcess(): MetroProcess & {
  emitLine(event: LineEvent): void;
  emitState(state: ProcessState): void;
  emitExit(info?: ExitInfo): void;
  markReady(): void;
  markReadyError(err: Error): void;
  offLines: string[];
} {
  let resolveReady!: () => void;
  let rejectReady!: (err: Error) => void;
  const waitReady = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let resolveStop!: (info: ExitInfo) => void;
  const stop = new Promise<ExitInfo>((resolve) => {
    resolveStop = resolve;
  });
  const lineHandlers = new Set<(event: LineEvent) => void>();
  const stateHandlers = new Set<(state: ProcessState) => void>();
  const exitHandlers = new Set<(info: ExitInfo) => void>();
  // Lines as plain strings, matching the real `LineStream.lines()` shape.
  const offLines: string[] = [];

  return {
    pid: 42,
    stdout: { lines: () => [...offLines] },
    waitReady: () => waitReady,
    onLine: (h) => {
      lineHandlers.add(h);
      return () => lineHandlers.delete(h);
    },
    onStateChange: (h) => {
      stateHandlers.add(h);
      return () => stateHandlers.delete(h);
    },
    onExit: (h) => {
      exitHandlers.add(h);
      return () => exitHandlers.delete(h);
    },
    stop: () => stop,
    emitLine: (event) => {
      offLines.push(event.text);
      for (const h of [...lineHandlers]) h(event);
    },
    emitState: (state) => {
      for (const h of [...stateHandlers]) h(state);
    },
    emitExit: (info = { code: 0, signal: null, forced: false }) => {
      for (const h of [...exitHandlers]) h(info);
      resolveStop(info);
    },
    markReady: () => resolveReady(),
    markReadyError: (err) => rejectReady(err),
    offLines,
  };
}

function makeController(
  opts: { now?: () => number; readFile?: (path: string) => Promise<string | null> } = {},
) {
  const logs: MetroLogEvent[] = [];
  const statuses: string[] = [];
  const proc = makeFakeProcess();
  const readFile =
    opts.readFile ??
    (async (path) =>
      path === '/work/app/package.json'
        ? JSON.stringify({ name: 'myapp', dependencies: { 'react-native': '0.74.0' } })
        : null);
  const controller = new MetroController({
    // ProcessManager is not actually used when spawn is injected, but the type demands it.
    processes: {} as never,
    spawn: () => proc,
    now: opts.now ?? FIXED_NOW,
    readFile,
  });
  controller.onLog((e) => logs.push(e));
  controller.onStatus((s) => statuses.push(s));
  return { controller, logs, statuses, proc };
}

describe('extractMetroPort', () => {
  it('extracts the port from a "Metro waiting" line', () => {
    expect(extractMetroPort('Metro waiting on http://localhost:8081')).toBe(8081);
  });
  it('extracts the port from a "Server listening" line', () => {
    expect(extractMetroPort('Server listening on http://127.0.0.1:8082')).toBe(8082);
  });
  it('returns null for non-ready lines', () => {
    expect(extractMetroPort('Starting Metro...')).toBeNull();
    expect(extractMetroPort('Welcome to Metro!')).toBeNull();
  });
});

describe('buildMetroCommand', () => {
  it('uses `npx react-native start` for both bare RN and Expo (v1 simplicity)', () => {
    expect(buildMetroCommand(detectedBareRn)).toEqual({
      command: 'npx',
      args: ['--yes', 'react-native', 'start'],
    });
    expect(buildMetroCommand(detectedExpo)).toEqual({
      command: 'npx',
      args: ['--yes', 'react-native', 'start'],
    });
  });
});

describe('MetroController', () => {
  it('happy path: detects project, starts, becomes ready with the captured port', async () => {
    const { controller, proc, statuses } = makeController();
    const startP = controller.start('/work/app');
    // Simulate Metro's output arriving after the controller has wired its handlers.
    // (In real life, lines stream from the OS pipe; in the test we have to wait for the
    // start() continuation to run so wire() has registered the onLine handler.)
    await new Promise((r) => setImmediate(r));
    proc.emitLine({ stream: 'stdout', text: 'Starting Metro...' });
    proc.emitLine({ stream: 'stderr', text: 'Metro waiting on http://localhost:8081' });
    proc.markReady();

    const started = await startP;
    expect(started.project.kind).toBe('bare-rn');
    expect(started.project.name).toBe('myapp');
    expect(started.port).toBe(8081);
    expect(started.pid).toBe(42);
    expect(controller.status).toBe('ready');
    expect(statuses).toEqual(['starting', 'ready']);
  });

  it('rejects with an "unsupported project" message when package.json has no RN/Expo dep', async () => {
    const proc = makeFakeProcess();
    const controllerNoSpawn = new MetroController({
      processes: {} as never,
      spawn: vi.fn(() => proc),
      now: FIXED_NOW,
      // /empty/package.json doesn't exist → classification is "unknown"
      readFile: async () => null,
    });
    await expect(controllerNoSpawn.start('/empty')).rejects.toThrow(/No React Native/);
    expect(controllerNoSpawn.status).toBe('unsupported-project');
  });

  it('marks itself "errored" if the process dies before becoming ready', async () => {
    const { controller, proc, statuses } = makeController();
    const startP = controller.start('/work/app');
    proc.markReadyError(new Error('spawn ENOENT'));
    await expect(startP).rejects.toThrow(/ENOENT/);
    expect(controller.status).toBe('errored');
    expect(statuses).toEqual(['starting', 'errored']);
  });

  it('marks itself "errored" on an unexpected exit AFTER ready (process crashed)', async () => {
    const { controller, proc, statuses } = makeController();
    const startP = controller.start('/work/app');
    proc.emitLine({ stream: 'stderr', text: 'Metro waiting on http://localhost:8081' });
    proc.markReady();
    await startP;
    expect(controller.status).toBe('ready');
    proc.emitExit({ code: 1, signal: null, forced: false });
    expect(controller.status).toBe('errored');
    expect(statuses.at(-1)).toBe('errored');
  });

  it('stop() goes through stopping → idle and resolves the stop promise', async () => {
    const { controller, proc, statuses } = makeController();
    const startP = controller.start('/work/app');
    proc.emitLine({ stream: 'stderr', text: 'Metro waiting on http://localhost:8081' });
    proc.markReady();
    await startP;
    const stopP = controller.stop();
    expect(controller.status).toBe('stopping');
    proc.emitExit({ code: 0, signal: 'SIGTERM', forced: false });
    await stopP;
    expect(controller.status).toBe('idle');
    expect(statuses.at(-1)).toBe('idle');
  });

  it('rejects a second start while already ready (no double-spawn)', async () => {
    const { controller, proc } = makeController();
    const startP = controller.start('/work/app');
    proc.emitLine({ stream: 'stderr', text: 'Metro waiting on http://localhost:8081' });
    proc.markReady();
    await startP;
    await expect(controller.start('/work/app')).rejects.toThrow(/already/);
  });

  it('captures the port on the first matching log line, even before markReady', async () => {
    const { controller, proc } = makeController();
    const startP = controller.start('/work/app');
    proc.emitLine({ stream: 'stderr', text: 'Server listening on http://localhost:8082' });
    proc.markReady();
    const started = await startP;
    expect(started.port).toBe(8082);
  });
});
