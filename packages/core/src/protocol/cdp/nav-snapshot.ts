import { evaluateOnTarget, type CdpSendLike, type EvaluateResult } from './eval.js';
import { NAV_PROBE, walkNavState, type NavStateSnapshot, type NavProbe } from './nav-probe.js';

/**
 * The M3 navigation inspector's typed snapshot (E-20). Composes the CDP
 * round-trip (read `globalThis.__ICARUS_NAV_STATE__`) with the defensive
 * walker into a single typed `NavSnapshot` the renderer can render.
 *
 * Pure: never throws, every failure is a typed `Result` variant.
 */

export type NavSnapshot =
  | { readonly ok: true; readonly state: NavStateSnapshot }
  | { readonly ok: false; readonly kind: 'not_connected' }
  | { readonly ok: false; readonly kind: 'no_bridge' }
  | { readonly ok: false; readonly kind: 'invalid_format'; readonly reason: string }
  | { readonly ok: false; readonly kind: 'timeout' }
  | { readonly ok: false; readonly kind: 'cdp_error'; readonly message: string }
  | {
      readonly ok: false;
      readonly kind: 'remote_exception';
      readonly name: string;
      readonly message: string;
    };

const DEFAULT_TIMEOUT_MS = 5_000;

type RawProbeResponse =
  | { readonly ok: true; readonly state: unknown }
  | { readonly ok: false; readonly kind: 'no_bridge' };

type EvalFailure = Extract<EvaluateResult<unknown>, { ok: false }>;

export async function takeNavSnapshot(cdp: CdpSendLike | null): Promise<NavSnapshot> {
  if (cdp === null) return { ok: false, kind: 'not_connected' };
  const raw = await evaluateOnTarget<RawProbeResponse>(cdp, NAV_PROBE, {
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (!raw.ok) {
    return mapEvalFailure(raw);
  }
  const value = raw.value;
  if (value === null || value === undefined) {
    return { ok: false, kind: 'invalid_format', reason: 'empty response' };
  }
  if (value.ok === false) {
    if (value.kind === 'no_bridge') return { ok: false, kind: 'no_bridge' };
    return { ok: false, kind: 'invalid_format', reason: value.kind };
  }
  const walked: NavProbe = walkNavState(value.state);
  if (!walked.ok) {
    return { ok: false, kind: 'invalid_format', reason: walked.reason };
  }
  return { ok: true, state: walked.state };
}

function mapEvalFailure(raw: EvalFailure): NavSnapshot {
  switch (raw.kind) {
    case 'timeout':
      return { ok: false, kind: 'timeout' };
    case 'remote_exception':
      return {
        ok: false,
        kind: 'remote_exception',
        name: raw.name,
        message: raw.message,
      };
    case 'cdp_error':
      return { ok: false, kind: 'cdp_error', message: raw.message };
  }
}
