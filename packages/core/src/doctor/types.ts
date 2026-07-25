/**
 * Types for the environment doctor (TR-4). The doctor detects and validates the local
 * toolchain Icarus depends on and reports actionable results — it never silently fails
 * (Coding Standards). A missing tool is a *finding*, not a crash.
 */

/** Outcome of a single check. */
export type CheckStatus = 'ok' | 'not-found' | 'outdated' | 'error';

/** How much a check matters to the overall verdict. */
export type CheckSeverity = 'required' | 'recommended' | 'info';

export interface DoctorCheck {
  /** Stable id, e.g. "node". */
  readonly id: string;
  /** Human label, e.g. "Node.js". */
  readonly label: string;
  readonly status: CheckStatus;
  readonly severity: CheckSeverity;
  /** Resolved absolute path, when found. */
  readonly path?: string;
  /** Detected version string, when found. */
  readonly version?: string;
  /** One-line human explanation (esp. on failure). */
  readonly detail?: string;
  /** Actionable fix, e.g. "brew install watchman". */
  readonly remedy?: string;
}

export type OverallStatus = 'ok' | 'warn' | 'error';

export interface DoctorReport {
  readonly generatedAt: string;
  readonly platform: NodeJS.Platform;
  readonly checks: readonly DoctorCheck[];
  readonly overall: OverallStatus;
}

/** Result of probing for a single command-line tool. */
export interface ToolProbeResult {
  /** Resolved absolute path, or null if not found. */
  readonly path: string | null;
  /** Raw version output (first line), or null if unavailable. */
  readonly versionOutput: string | null;
}

/**
 * Abstraction over the OS so the doctor's logic is deterministic and unit-testable:
 * the real implementation shells out; tests inject a fake.
 */
export interface ToolRunner {
  readonly platform: NodeJS.Platform;
  probe(command: string, versionArgs: readonly string[]): Promise<ToolProbeResult>;
}
