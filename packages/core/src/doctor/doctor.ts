import { NodeToolRunner } from './tool-runner.js';
import type {
  CheckSeverity,
  DoctorCheck,
  DoctorReport,
  OverallStatus,
  ToolRunner,
} from './types.js';

/** Spec describing how to check for one tool. */
interface ToolSpec {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly versionArgs: readonly string[];
  readonly severity: CheckSeverity;
  readonly remedy: string;
  /** Minimum major version, when we enforce a floor. */
  readonly minMajor?: number;
  /** Only run on these platforms; on others the check is reported as info/skipped. */
  readonly platforms?: readonly NodeJS.Platform[];
}

const TOOL_SPECS: readonly ToolSpec[] = [
  {
    id: 'node',
    label: 'Node.js',
    command: 'node',
    versionArgs: ['--version'],
    severity: 'required',
    minMajor: 22,
    remedy: 'Install Node.js >= 22 (see .nvmrc).',
  },
  {
    id: 'watchman',
    label: 'Watchman',
    command: 'watchman',
    versionArgs: ['--version'],
    severity: 'recommended',
    remedy: 'brew install watchman (improves Metro file watching).',
  },
  {
    id: 'adb',
    label: 'Android Debug Bridge (adb)',
    command: 'adb',
    versionArgs: ['--version'],
    severity: 'recommended',
    remedy: 'Install Android SDK platform-tools and add adb to PATH.',
  },
  {
    id: 'xcrun',
    label: 'Xcode command line tools (xcrun)',
    command: 'xcrun',
    versionArgs: ['--version'],
    severity: 'recommended',
    remedy: 'xcode-select --install (required for iOS simulators).',
    platforms: ['darwin'],
  },
];

/** Extract a semver-ish version (e.g. "22.19.0") from arbitrary version output. */
export function parseVersion(output: string | null): string | null {
  if (!output) return null;
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  return match ? match[0] : null;
}

function majorOf(version: string | null): number | null {
  if (!version) return null;
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isNaN(major) ? null : major;
}

async function checkTool(runner: ToolRunner, spec: ToolSpec): Promise<DoctorCheck> {
  // Platform-gated tools are reported as info (not a failure) on other platforms.
  if (spec.platforms && !spec.platforms.includes(runner.platform)) {
    return {
      id: spec.id,
      label: spec.label,
      status: 'ok',
      severity: 'info',
      detail: `Not applicable on ${runner.platform}.`,
    };
  }

  const { path, versionOutput } = await runner.probe(spec.command, spec.versionArgs);
  if (path === null) {
    return {
      id: spec.id,
      label: spec.label,
      status: 'not-found',
      severity: spec.severity,
      detail: `${spec.command} was not found on PATH.`,
      remedy: spec.remedy,
    };
  }

  const version = parseVersion(versionOutput);
  const base = { id: spec.id, label: spec.label, severity: spec.severity, path } as const;

  if (spec.minMajor !== undefined) {
    const major = majorOf(version);
    if (major !== null && major < spec.minMajor) {
      return {
        ...base,
        status: 'outdated',
        ...(version ? { version } : {}),
        detail: `Found ${version}, but >= ${spec.minMajor} is required.`,
        remedy: spec.remedy,
      };
    }
  }

  return {
    ...base,
    status: 'ok',
    ...(version ? { version } : { detail: 'Found, but version could not be determined.' }),
  };
}

function rollUp(checks: readonly DoctorCheck[]): OverallStatus {
  const hasFailingRequired = checks.some((c) => c.severity === 'required' && c.status !== 'ok');
  if (hasFailingRequired) return 'error';
  const hasFailingRecommended = checks.some(
    (c) => c.severity === 'recommended' && c.status !== 'ok',
  );
  return hasFailingRecommended ? 'warn' : 'ok';
}

export interface RunDoctorOptions {
  readonly runner?: ToolRunner;
  readonly now?: () => Date;
}

/**
 * Run the environment doctor. Deterministic given an injected runner/clock; the default
 * runner shells out to the real OS. Never throws for a missing tool.
 */
export async function runDoctor(options: RunDoctorOptions = {}): Promise<DoctorReport> {
  const runner = options.runner ?? new NodeToolRunner();
  const now = options.now ?? (() => new Date());

  const checks = await Promise.all(TOOL_SPECS.map((spec) => checkTool(runner, spec)));

  return {
    generatedAt: now().toISOString(),
    platform: runner.platform,
    checks,
    overall: rollUp(checks),
  };
}
