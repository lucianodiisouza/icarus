/**
 * The unified log record (E-10). Every entry carries its source so the UI can
 * label/filter without having to know the producer. Times are wall-clock ms.
 *
 * Sources:
 *   - \`cdp\`     — app console via CDP \`Runtime.consoleAPICalled\` (E-14)
 *   - \`native\`  — OS-level logs from the booted simulator (simctl log stream) (E-10)
 *   - \`metro\`   — Metro dev-server output (E-08) — useful for build errors
 *
 * Network events (E-14 slice 5) are deliberately NOT in this stream — they have
 * a different shape (request/response pairs, not line-by-line) and the
 * NetworkSection in the renderer has its own panel.
 */
export type UnifiedLogSource = 'cdp' | 'native' | 'metro';

export type UnifiedLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface UnifiedLogEntry {
  readonly source: UnifiedLogSource;
  /** Coarse level (renderer maps this to a color). Default 'log' if unknown. */
  readonly level: UnifiedLogLevel;
  /** The line of text. May be multi-line for Metro stderr; the UI scrolls horizontally. */
  readonly text: string;
  /** Event time in ms since epoch (CDP timestamp or now()). */
  readonly timestampMs: number;
  /**
   * Optional origin tag — for CDP entries, the source file/line if Hermes gave it.
   * For native entries, the subsystem (e.g. "com.apple.UIKit"). For Metro, undefined.
   */
  readonly origin?: string;
}
