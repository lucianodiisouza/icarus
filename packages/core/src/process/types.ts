/**
 * Types for the ProcessManager (G-2, TR-2) — the single trustworthy way anything in Icarus
 * spawns and controls an OS process (Metro, emulators, adb, simctl). Electron-free
 * (ADR-0002). The hard guarantee: Icarus never leaks orphaned child processes.
 */

/** Lifecycle states. `ready` is only reached when a `readyWhen` probe matches. */
export type ProcessState =
  | 'starting' // spawn requested, not yet running
  | 'running' // OS process is alive
  | 'ready' // running AND readyWhen matched (e.g. "Metro is up")
  | 'stopping' // stop() in progress
  | 'exited' // terminated (cleanly or killed)
  | 'errored'; // failed to spawn

export interface ExitInfo {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** True if we had to escalate to a forced kill (SIGKILL). */
  readonly forced: boolean;
}

export interface ShutdownPolicy {
  /** Signal tried first for a graceful stop. Default: SIGTERM. */
  readonly signal?: NodeJS.Signals;
  /** How long to wait for graceful exit before escalating to SIGKILL. Default: 5000ms. */
  readonly graceMs?: number;
}

export interface ProcessSpec {
  /** Stable id; auto-generated if omitted. */
  readonly id?: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  /** Extra env, merged over process.env. */
  readonly env?: Readonly<Record<string, string>>;
  /** Optional readiness probe over stdout/stderr lines; when it matches, state → ready. */
  readonly readyWhen?: (line: string) => boolean;
  readonly shutdown?: ShutdownPolicy;
  /** Max retained lines per stream (bounded buffer). Default: 1000. */
  readonly maxBufferedLines?: number;
}

export interface StopOptions {
  readonly signal?: NodeJS.Signals;
  readonly graceMs?: number;
}

export type StreamName = 'stdout' | 'stderr';

export interface LineEvent {
  readonly stream: StreamName;
  readonly text: string;
}
