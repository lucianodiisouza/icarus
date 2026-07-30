import { evaluateOnTarget, type CdpSendLike, type EvaluateResult } from '../cdp/eval.js';
import {
  storageDeleteExpression,
  storageGetExpression,
  storageListExpression,
  type StorageBackendKind,
} from './expressions.js';

/**
 * The M3 storage inspector's typed wrapper (E-18). Owns the JS expressions that
 * talk to AsyncStorage / MMKV in the running app, and turns the raw
 * `Runtime.evaluate` results into a uniform `StorageSnapshot` shape the
 * renderer can pattern-match on.
 *
 * Pure (no Electron, no state). The desktop wires this through its own
 * `evaluateOnTarget`-compatible seam; the renderer sees the result via the
 * `storage.*` IPC channels.
 *
 * Failure modes are typed (not thrown): `not_connected`, `no_module`,
 * `no_key`, `timeout`, `cdp_error`, `remote_exception` — each carries the
 * info the UI needs to render the right "why this didn't work" message.
 */

export interface StorageKey {
  readonly key: string;
  readonly preview: string;
  readonly kind: 'string' | 'number' | 'boolean' | 'object' | 'null' | 'unknown';
}

export type ValueKind = 'string' | 'number' | 'boolean' | 'object' | 'null' | 'unknown';

export interface StorageFull {
  readonly value: string;
  readonly kind: ValueKind;
}

export type StorageSnapshot =
  | { readonly ok: true; readonly keys: readonly StorageKey[] }
  | { readonly ok: false; readonly kind: 'not_connected' }
  | { readonly ok: false; readonly kind: 'no_module' }
  | { readonly ok: false; readonly kind: 'timeout' }
  | { readonly ok: false; readonly kind: 'cdp_error'; readonly message: string }
  | {
      readonly ok: false;
      readonly kind: 'remote_exception';
      readonly name: string;
      readonly message: string;
    };

export type StorageGetResult =
  | { readonly ok: true; readonly value: StorageFull }
  | { readonly ok: false; readonly kind: 'not_connected' }
  | { readonly ok: false; readonly kind: 'no_module' }
  | { readonly ok: false; readonly kind: 'no_key' }
  | { readonly ok: false; readonly kind: 'timeout' }
  | { readonly ok: false; readonly kind: 'cdp_error'; readonly message: string }
  | {
      readonly ok: false;
      readonly kind: 'remote_exception';
      readonly name: string;
      readonly message: string;
    };

export type StorageDeleteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: 'not_connected' }
  | { readonly ok: false; readonly kind: 'no_module' }
  | { readonly ok: false; readonly kind: 'timeout' }
  | { readonly ok: false; readonly kind: 'cdp_error'; readonly message: string }
  | {
      readonly ok: false;
      readonly kind: 'remote_exception';
      readonly name: string;
      readonly message: string;
    };

const DEFAULT_TIMEOUT_MS = 5_000;

/** The shape the LIST expression returns on a happy path. */
interface RawListResult {
  readonly ok: boolean;
  readonly kind?: 'no_module';
  readonly keys?: readonly {
    readonly key: string;
    readonly preview: string;
    readonly kind: string;
  }[];
}

interface RawGetResult {
  readonly ok: boolean;
  readonly kind?: 'no_module' | 'no_key';
  readonly value?: string;
  readonly valueKind?: string;
}

interface RawDeleteResult {
  readonly ok: boolean;
  readonly kind?: 'no_module';
}

type EvalFailure = Extract<EvaluateResult<unknown>, { ok: false }>;

function mapEvalFailure(
  raw: EvalFailure,
):
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cdp_error'; readonly message: string }
  | { readonly kind: 'remote_exception'; readonly name: string; readonly message: string } {
  switch (raw.kind) {
    case 'timeout':
      return { kind: 'timeout' };
    case 'remote_exception':
      return {
        kind: 'remote_exception',
        name: raw.name,
        message: raw.message,
      };
    case 'cdp_error':
      return { kind: 'cdp_error', message: raw.message };
  }
}

function asValueKind(s: string | undefined): ValueKind {
  switch (s) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'object':
    case 'null':
    case 'unknown':
      return s;
    default:
      return 'unknown';
  }
}

export async function listStorage(
  cdp: CdpSendLike | null,
  backend: StorageBackendKind,
  options: { readonly timeoutMs?: number } = {},
): Promise<StorageSnapshot> {
  if (cdp === null) return { ok: false, kind: 'not_connected' };
  const raw = await evaluateOnTarget<RawListResult>(cdp, storageListExpression(backend), {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (!raw.ok) return { ok: false, ...mapEvalFailure(raw) };
  const value = raw.value;
  if (value === null || value === undefined || typeof value !== 'object') {
    return { ok: false, kind: 'no_module' };
  }
  if (value.ok === false) {
    if (value.kind === 'no_module') return { ok: false, kind: 'no_module' };
    return { ok: false, kind: 'no_module' };
  }
  const rawKeys = value.keys ?? [];
  return {
    ok: true,
    keys: rawKeys.map((k) => ({
      key: k.key,
      preview: k.preview,
      kind: asValueKind(k.kind),
    })),
  };
}

export async function getStorageValue(
  cdp: CdpSendLike | null,
  backend: StorageBackendKind,
  key: string,
  options: { readonly timeoutMs?: number } = {},
): Promise<StorageGetResult> {
  if (cdp === null) return { ok: false, kind: 'not_connected' };
  const raw = await evaluateOnTarget<RawGetResult>(cdp, storageGetExpression(backend, key), {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (!raw.ok) return { ok: false, ...mapEvalFailure(raw) };
  const value = raw.value;
  if (value === null || value === undefined || typeof value !== 'object') {
    return { ok: false, kind: 'no_module' };
  }
  if (value.ok === false) {
    if (value.kind === 'no_key') return { ok: false, kind: 'no_key' };
    return { ok: false, kind: 'no_module' };
  }
  return {
    ok: true,
    value: { value: value.value ?? '', kind: asValueKind(value.valueKind) },
  };
}

export async function deleteStorageKey(
  cdp: CdpSendLike | null,
  backend: StorageBackendKind,
  key: string,
  options: { readonly timeoutMs?: number } = {},
): Promise<StorageDeleteResult> {
  if (cdp === null) return { ok: false, kind: 'not_connected' };
  const raw = await evaluateOnTarget<RawDeleteResult>(cdp, storageDeleteExpression(backend, key), {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (!raw.ok) return { ok: false, ...mapEvalFailure(raw) };
  const value = raw.value;
  if (value === null || value === undefined || typeof value !== 'object') {
    return { ok: false, kind: 'no_module' };
  }
  if (value.ok === false) {
    return { ok: false, kind: 'no_module' };
  }
  return { ok: true };
}
