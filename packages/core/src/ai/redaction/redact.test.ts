import { describe, expect, it } from 'vitest';
import { redact, type RedactionCategory } from './redact.js';

/** Convenience: the categories that fired, as a plain object of counts. */
function counts(input: string): Partial<Record<RedactionCategory, number>> {
  const out: Partial<Record<RedactionCategory, number>> = {};
  for (const hit of redact(input).hits) out[hit.category] = hit.count;
  return out;
}

describe('redact — secrets', () => {
  it('masks a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dozjgNryP4J3jVmNHl0w5N';
    const { text, hits } = redact(`token is ${jwt} ok`);
    expect(text).toBe('token is [REDACTED:jwt] ok');
    expect(hits).toEqual([{ category: 'jwt', count: 1 }]);
  });

  it('masks Bearer and Basic authorization values but keeps the scheme', () => {
    expect(redact('Authorization: Bearer abc123.def-456_XY').text).toBe(
      'Authorization: Bearer [REDACTED:authorization]',
    );
    expect(redact('Authorization: Basic dXNlcjpwYXNz').text).toBe(
      'Authorization: Basic [REDACTED:authorization]',
    );
  });

  it('masks well-known API-key shapes', () => {
    expect(redact('key sk-abcdefghijklmnop1234 end').text).toContain('[REDACTED:api-key]');
    expect(redact('AKIAIOSFODNN7EXAMPLE').text).toBe('[REDACTED:api-key]');
    expect(redact('AIzaSyA1234567890123456789012345678901x').text).toBe('[REDACTED:api-key]');
    expect(redact('ghp_' + 'a'.repeat(36)).text).toBe('[REDACTED:api-key]');
    expect(redact('xoxb-123456789012-abcdefghij').text).toContain('[REDACTED:api-key]');
  });

  it('masks the value of a secret assignment, keeping the key and separator', () => {
    expect(redact('password="hunter2"').text).toBe('password="[REDACTED:secret-assignment]"');
    expect(redact('api_key = ABC123XYZ').text).toBe('api_key = [REDACTED:secret-assignment]');
    expect(redact('{ "token": "s3cr3t" }').text).toContain(
      '"token": "[REDACTED:secret-assignment]',
    );
  });
});

describe('redact — PII', () => {
  it('masks an email address', () => {
    expect(redact('contact dev@example.com now').text).toBe('contact [REDACTED:email] now');
  });

  it('masks only the username segment of a home path (keeps structure)', () => {
    expect(redact('at /Users/luciano/app/src/index.ts:4').text).toBe(
      'at /Users/[REDACTED:home-path]/app/src/index.ts:4',
    );
    expect(redact('/home/ci/project/main.js').text).toBe(
      '/home/[REDACTED:home-path]/project/main.js',
    );
    expect(redact('C:\\Users\\Dev\\proj\\a.ts').text).toBe(
      'C:\\Users\\[REDACTED:home-path]\\proj\\a.ts',
    );
  });
});

describe('redact — counting & multiplicity', () => {
  it('counts each category across multiple occurrences', () => {
    const input = 'a@b.com and c@d.io, password=x, secret=y';
    expect(counts(input)).toEqual({ email: 2, 'secret-assignment': 2 });
  });

  it('returns an empty hit list when there is nothing to redact', () => {
    const clean = 'Rendered 24 rows in 3ms; nav to Home; state updated';
    expect(redact(clean)).toEqual({ text: clean, hits: [] });
  });

  it('does not double-redact a value already masked by an earlier rule', () => {
    // `token=<jwt>` — the JWT rule fires first; the assignment rule must not re-attribute it.
    const jwt = 'eyJx.eyJy.zzz';
    const { text, hits } = redact(`token=${jwt}`);
    expect(text).toBe('token=[REDACTED:jwt]');
    expect(hits).toEqual([{ category: 'jwt', count: 1 }]);
  });
});

describe('redact — precision (no false positives on ordinary logs)', () => {
  it('leaves normal words, versions, hex, and prose untouched', () => {
    const samples = [
      'Metro waiting on http://localhost:8081',
      'Reloading app… bundle built in 1423ms',
      'color #1a2b3c applied to <View>',
      'the authorization flow completed', // the word alone, no value
      'user tapped the Login button',
      'GET /api/users 200 in 42ms',
    ];
    for (const s of samples) expect(redact(s)).toEqual({ text: s, hits: [] });
  });

  it('is pure — same input yields the same result', () => {
    const input = 'password=abc and dev@x.com';
    expect(redact(input)).toEqual(redact(input));
  });

  it('never throws on odd input', () => {
    expect(() => redact('')).not.toThrow();
    expect(redact('').hits).toEqual([]);
    expect(() => redact('@@@:::===\\\\///')).not.toThrow();
  });
});
