import type { CdpTarget } from './types.js';

/**
 * Pick the main JS runtime target to attach to (E-14). The spike found that a single app
 * can expose multiple CDP targets, and secondary ones (e.g. a "Reanimated UI runtime") are
 * partial/unresponsive — attaching there hangs. So we exclude known secondary runtimes,
 * require a debugger URL, and prefer the Fusebox-preferring main target.
 */

/** Descriptions that identify a secondary/worklet runtime we must NOT attach to. */
const SECONDARY_RUNTIME_PATTERNS: readonly RegExp[] = [/reanimated/i, /worklet/i];

function isSecondaryRuntime(target: CdpTarget): boolean {
  const haystack = `${target.description ?? ''} ${target.title ?? ''}`;
  return SECONDARY_RUNTIME_PATTERNS.some((re) => re.test(haystack));
}

/** Targets that are attachable main runtimes, best first. */
export function selectableTargets(targets: readonly CdpTarget[]): CdpTarget[] {
  const attachable = targets.filter(
    (t) => typeof t.webSocketDebuggerUrl === 'string' && !isSecondaryRuntime(t),
  );
  // Prefer targets that advertise the Fusebox frontend (the main JS runtime on modern RN).
  return attachable.sort((a, b) => fuseboxRank(b) - fuseboxRank(a));
}

function fuseboxRank(target: CdpTarget): number {
  return target.reactNative?.capabilities?.prefersFuseboxFrontend ? 1 : 0;
}

/** The single best target to attach to, or null if none is attachable. */
export function selectMainTarget(targets: readonly CdpTarget[]): CdpTarget | null {
  return selectableTargets(targets)[0] ?? null;
}
