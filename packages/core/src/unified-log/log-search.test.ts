import { describe, expect, it } from 'vitest';
import type { UnifiedLogEntry } from './unified-log.js';
import { filterEntries, matchesFilter } from './log-search.js';

const e = (over: Partial<UnifiedLogEntry>): UnifiedLogEntry => ({
  source: 'cdp',
  level: 'log',
  text: 'hello',
  timestampMs: 0,
  ...over,
});

describe('matchesFilter', () => {
  it('passes every entry when the filter is empty', () => {
    expect(matchesFilter(e({}), {})).toBe(true);
  });

  it('filters by case-insensitive text', () => {
    expect(matchesFilter(e({ text: 'Warning: boom' }), { text: 'BOOM' })).toBe(true);
    expect(matchesFilter(e({ text: 'all good' }), { text: 'BOOM' })).toBe(false);
  });

  it('filters by source set', () => {
    const sources = new Set<UnifiedLogEntry['source']>(['metro']);
    expect(matchesFilter(e({ source: 'metro' }), { sources })).toBe(true);
    expect(matchesFilter(e({ source: 'cdp' }), { sources })).toBe(false);
  });

  it('filters by level set', () => {
    const levels = new Set<UnifiedLogEntry['level']>(['error', 'warn']);
    expect(matchesFilter(e({ level: 'error' }), { levels })).toBe(true);
    expect(matchesFilter(e({ level: 'warn' }), { levels })).toBe(true);
    expect(matchesFilter(e({ level: 'info' }), { levels })).toBe(false);
  });

  it('composes all three constraints with AND', () => {
    const filter = {
      text: 'auth',
      sources: new Set<UnifiedLogEntry['source']>(['cdp']),
      levels: new Set<UnifiedLogEntry['level']>(['error']),
    };
    expect(matchesFilter(e({ text: 'auth failed', level: 'error' }), filter)).toBe(true);
    expect(matchesFilter(e({ text: 'auth failed', level: 'warn' }), filter)).toBe(false);
    expect(matchesFilter(e({ text: 'auth failed', level: 'error', source: 'metro' }), filter)).toBe(
      false,
    );
  });
});

describe('filterEntries', () => {
  it('returns a new array; never mutates the input', () => {
    const entries: UnifiedLogEntry[] = [
      e({ text: 'first' }),
      e({ text: 'second' }),
      e({ text: 'first again' }),
    ];
    const result = filterEntries(entries, { text: 'first' });
    expect(result.map((x) => x.text)).toEqual(['first', 'first again']);
    expect(entries).toHaveLength(3);
  });
});
