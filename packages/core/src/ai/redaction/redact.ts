/**
 * The redaction pass (E-12, M2 plan Part A · T-12.1). A **pure** function that scrubs the
 * secrets and PII a debug log is likely to carry before any of it can be assembled for the
 * AI (TR-5). This is the trust-critical core of the data boundary: `buildAiSendPayload`
 * (T-12.4) runs everything through here, and the canary test (T-12.7) plants a fake secret
 * and asserts it never survives.
 *
 * Design stance: **precision-first**. We would rather miss an exotic secret than mangle
 * ordinary log lines into noise, so each rule targets an unambiguous shape (a JWT's `eyJ`
 * header, a known key prefix, an `Authorization` value, an email, a `secret=...` pair, a
 * home-dir username). Every replacement is counted by category so the UI can show exactly
 * what was scrubbed. Electron-free (ADR-0002).
 */

export type RedactionCategory =
  'jwt' | 'authorization' | 'api-key' | 'email' | 'secret-assignment' | 'home-path';

export interface RedactionHit {
  readonly category: RedactionCategory;
  readonly count: number;
}

export interface RedactionResult {
  /** The input with every matched secret/PII replaced by a typed placeholder. */
  readonly text: string;
  /** How many replacements happened, per category (only categories that fired appear). */
  readonly hits: readonly RedactionHit[];
}

const mask = (category: RedactionCategory): string => `[REDACTED:${category}]`;

interface Rule {
  readonly category: RedactionCategory;
  readonly pattern: RegExp; // must be global
  readonly replace: (match: string, ...groups: string[]) => string;
}

/**
 * Ordered rules. Order matters: more specific shapes run first so a value already masked by
 * an earlier rule isn't re-attributed by a later, broader one (the assignment rule also
 * refuses to touch an existing `[REDACTED:` placeholder).
 */
const RULES: readonly Rule[] = [
  // A JWT: base64url header starting `eyJ` + two more dot-separated segments.
  {
    category: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replace: () => mask('jwt'),
  },
  // Authorization values: `Bearer <token>` / `Basic <base64>` (keep the scheme, drop the secret).
  {
    category: 'authorization',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    replace: () => `Bearer ${mask('authorization')}`,
  },
  {
    category: 'authorization',
    pattern: /\bBasic\s+[A-Za-z0-9+/]+=*/gi,
    replace: () => `Basic ${mask('authorization')}`,
  },
  // Well-known API-key shapes (all → api-key).
  { category: 'api-key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/g, replace: () => mask('api-key') },
  { category: 'api-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replace: () => mask('api-key') },
  { category: 'api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: () => mask('api-key') },
  {
    category: 'api-key',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    replace: () => mask('api-key'),
  },
  {
    category: 'api-key',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    replace: () => mask('api-key'),
  },
  // Email (PII).
  {
    category: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: () => mask('email'),
  },
  // `password=...`, `token: "..."`, `api_key=...` etc. Keep the key + separator, drop the value.
  // The value pattern refuses to consume an already-inserted placeholder.
  {
    category: 'secret-assignment',
    pattern:
      /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|auth[_-]?token)(["']?\s*[:=]\s*["']?)(?!\[REDACTED)([^\s"',}]+)/gi,
    replace: (_m, key, sep) => `${key}${sep}${mask('secret-assignment')}`,
  },
  // Home-dir username (PII): keep the path shape, scrub the identity.
  {
    category: 'home-path',
    pattern: /(\/Users\/|\/home\/)([^/\s]+)/g,
    replace: (_m, prefix) => `${prefix}${mask('home-path')}`,
  },
  {
    category: 'home-path',
    pattern: /([A-Za-z]:\\Users\\)([^\\/\s]+)/g,
    replace: (_m, prefix) => `${prefix}${mask('home-path')}`,
  },
];

/**
 * Redact secrets/PII from a single string. Pure: same input → same output; never throws.
 */
export function redact(input: string): RedactionResult {
  const counts = new Map<RedactionCategory, number>();
  let text = input;
  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match: string, ...rest: unknown[]): string => {
      counts.set(rule.category, (counts.get(rule.category) ?? 0) + 1);
      const groups = rest.slice(0, -2) as string[]; // drop trailing offset + full-string args
      return rule.replace(match, ...groups);
    });
  }
  const hits = [...counts.entries()].map(([category, count]) => ({ category, count }));
  return { text, hits };
}
