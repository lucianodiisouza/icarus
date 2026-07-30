/**
 * The M3 storage inspector's JS expressions (E-18). The `Runtime.evaluate` shape
 * we ship to the running app to read / delete keys in AsyncStorage and MMKV.
 *
 * Why these expressions, not a bridge / in-app module: the dev tools pattern
 * is to read state from a running app via `Runtime.evaluate`. The expressions
 * are tiny IIFEs that try to require the storage module, walk its API, and
 * return a JSON-serializable result. They:
 *   - never mutate the app (the delete path is opt-in, behind a separate IPC)
 *   - never call into user code
 *   - never throw (any failure path returns a typed `{ ok: false, kind }`
 *     object that the inspector's UI can render verbatim)
 *
 * The expressions are tested by injecting a mock CDP `send` and asserting the
 * result shape. The desktop wires them through `evaluateOnTarget`.
 *
 * The AsyncStorage and MMKV modules are looked up on `globalThis` first
 * (some apps stash the module there) and then via `require` (the standard
 * Metro path). If neither works, the expression returns `no_module`.
 */

export type StorageBackendKind = 'async-storage' | 'mmkv';

/** The shared helpers used by both backends (stringify, resolve-module). */
const SHARED_HELPERS = `
function previewValue(v) {
  if (v === null) return { preview: 'null', kind: 'null' };
  if (v === undefined) return { preview: 'undefined', kind: 'unknown' };
  const t = typeof v;
  if (t === 'string') return { preview: JSON.stringify(v).slice(0, 120), kind: 'string' };
  if (t === 'number' || t === 'boolean' || t === 'bigint') return { preview: String(v), kind: t };
  try {
    return { preview: JSON.stringify(v).slice(0, 120), kind: 'object' };
  } catch (_e) {
    return { preview: String(v), kind: 'unknown' };
  }
}
function stringify(v) {
  if (v === null) return { value: 'null', kind: 'null' };
  if (v === undefined) return { value: 'undefined', kind: 'unknown' };
  const t = typeof v;
  if (t === 'string') return { value: JSON.stringify(v), kind: 'string' };
  if (t === 'number' || t === 'boolean' || t === 'bigint') return { value: String(v), kind: t };
  try {
    return { value: JSON.stringify(v, null, 2), kind: 'object' };
  } catch (_e) {
    return { value: String(v), kind: 'unknown' };
  }
}
async function resolveAsyncStorage() {
  if (typeof globalThis.__IcarusAsyncStorage__ === 'object' && globalThis.__IcarusAsyncStorage__ !== null) {
    return globalThis.__IcarusAsyncStorage__;
  }
  try {
    const mod = require('@react-native-async-storage/async-storage');
    return mod?.default ?? mod;
  } catch (_e) {
    return null;
  }
}
function resolveMmkv() {
  if (typeof globalThis.__IcarusMmkv__ === 'object' && globalThis.__IcarusMmkv__ !== null) {
    return globalThis.__IcarusMmkv__;
  }
  try {
    const mod = require('react-native-mmkv');
    return mod?.default ?? mod;
  } catch (_e) {
    return null;
  }
}
`;

/** The body for the LIST operation, parameterized by backend. */
const ASYNC_LIST_BODY = `
  const mod = await resolveAsyncStorage();
  if (!mod) return { ok: false, kind: 'no_module' };
  const keys = await mod.getAllKeys();
  const items = [];
  for (const k of keys) {
    const v = await mod.getItem(k);
    const p = previewValue(v);
    items.push({ key: String(k), preview: p.preview, kind: p.kind });
  }
  return { ok: true, keys: items };
`;

const MMKV_LIST_BODY = `
  const mod = resolveMmkv();
  if (!mod) return { ok: false, kind: 'no_module' };
  const storage = mod.MMKV ? new mod.MMKV() : new (mod.default ?? mod)();
  const keys = storage.getAllKeys();
  const items = [];
  for (const k of keys) {
    const s = storage.getString(k);
    if (s !== undefined) {
      items.push({ key: String(k), preview: JSON.stringify(s).slice(0, 120), kind: 'string' });
      continue;
    }
    const n = storage.getNumber(k);
    if (n !== undefined) {
      items.push({ key: String(k), preview: String(n), kind: 'number' });
      continue;
    }
    const b = storage.getBoolean(k);
    if (b !== undefined) {
      items.push({ key: String(k), preview: String(b), kind: 'boolean' });
      continue;
    }
    items.push({ key: String(k), preview: '[binary]', kind: 'unknown' });
  }
  return { ok: true, keys: items };
`;

const ASYNC_GET_BODY = `
  const mod = await resolveAsyncStorage();
  if (!mod) return { ok: false, kind: 'no_module' };
  const v = await mod.getItem(KEY);
  if (v === null) return { ok: false, kind: 'no_key' };
  return { ok: true, ...stringify(v) };
`;

const MMKV_GET_BODY = `
  const mod = resolveMmkv();
  if (!mod) return { ok: false, kind: 'no_module' };
  const storage = mod.MMKV ? new mod.MMKV() : new (mod.default ?? mod)();
  if (!storage.contains(KEY)) return { ok: false, kind: 'no_key' };
  const s = storage.getString(KEY);
  if (s !== undefined) return { ok: true, ...stringify(s) };
  const n = storage.getNumber(KEY);
  if (n !== undefined) return { ok: true, ...stringify(n) };
  const b = storage.getBoolean(KEY);
  if (b !== undefined) return { ok: true, ...stringify(b) };
  return { ok: true, value: '[binary]', kind: 'unknown' };
`;

const ASYNC_DELETE_BODY = `
  const mod = await resolveAsyncStorage();
  if (!mod) return { ok: false, kind: 'no_module' };
  await mod.removeItem(KEY);
  return { ok: true };
`;

const MMKV_DELETE_BODY = `
  const mod = resolveMmkv();
  if (!mod) return { ok: false, kind: 'no_module' };
  const storage = mod.MMKV ? new mod.MMKV() : new (mod.default ?? mod)();
  storage.delete(KEY);
  return { ok: true };
`;

/** Public: build the LIST expression for a given backend. */
export function storageListExpression(backend: StorageBackendKind): string {
  const body = backend === 'async-storage' ? ASYNC_LIST_BODY : MMKV_LIST_BODY;
  return `(async () => {${SHARED_HELPERS}${body}})()`;
}

/** Public: build the GET expression for a given backend. The KEY is the only
 *  runtime parameter; we substitute it once at build time (not via a JS string
 *  template) so the runtime can never see KEY as a free variable. */
export function storageGetExpression(backend: StorageBackendKind, key: string): string {
  const body = backend === 'async-storage' ? ASYNC_GET_BODY : MMKV_GET_BODY;
  return `(async () => { const KEY = ${JSON.stringify(key)};${SHARED_HELPERS}${body}})()`;
}

/** Public: build the DELETE expression for a given backend. */
export function storageDeleteExpression(backend: StorageBackendKind, key: string): string {
  const body = backend === 'async-storage' ? ASYNC_DELETE_BODY : MMKV_DELETE_BODY;
  return `(async () => { const KEY = ${JSON.stringify(key)};${SHARED_HELPERS}${body}})()`;
}
