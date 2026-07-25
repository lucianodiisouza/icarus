/**
 * Turns a CDP `Runtime.consoleAPICalled` event into a normalized log entry (E-14). This is
 * the first real data flowing into Icarus's shared model from a running RN app — proven
 * CDP-native in the spike. Pure and Electron-free (ADR-0002).
 */
export interface CdpConsoleEntry {
  /** console level: log | info | warning | error | debug | … (CDP `type`). */
  readonly level: string;
  /** Best-effort flattened text of the console arguments. */
  readonly text: string;
  /** Event time in ms since epoch (from CDP `timestamp`, else now). */
  readonly timestampMs: number;
}

interface RemoteObject {
  readonly type?: string;
  readonly value?: unknown;
  readonly description?: string;
  readonly unserializableValue?: string;
}

/** Render a single CDP RemoteObject argument to a short string. */
export function previewRemoteObject(arg: RemoteObject): string {
  if ('value' in arg && arg.value !== undefined) {
    return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
  }
  if (arg.unserializableValue !== undefined) return arg.unserializableValue;
  if (arg.description !== undefined) return arg.description;
  return arg.type ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parse `Runtime.consoleAPICalled` params into a CdpConsoleEntry, or null if the shape is
 * unexpected (never throws — bad data is dropped, not crashed on).
 */
export function formatConsoleEvent(
  params: unknown,
  now: () => number = Date.now,
): CdpConsoleEntry | null {
  if (!isRecord(params)) return null;
  const level = typeof params['type'] === 'string' ? params['type'] : 'log';
  const rawArgs = Array.isArray(params['args']) ? params['args'] : [];
  const text = rawArgs
    .map((arg) => (isRecord(arg) ? previewRemoteObject(arg) : String(arg)))
    .join(' ');
  // CDP timestamp is ms since epoch (a double); fall back to now if absent/invalid.
  const ts = params['timestamp'];
  const timestampMs = typeof ts === 'number' && Number.isFinite(ts) ? ts : now();
  return { level, text, timestampMs };
}
