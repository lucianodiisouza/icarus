import { describe, expect, it } from 'vitest';
import { parseSyslogLine } from './ios-syslog.js';

describe('parseSyslogLine', () => {
  it('extracts the level and message from a compact-style line', () => {
    const line = '2026-07-25 12:34:56.789 com.apple.UIKit info: view appeared';
    const parsed = parseSyslogLine(line);
    expect(parsed).toEqual({ level: 'info', text: 'view appeared' });
  });

  it('normalizes common level names', () => {
    expect(parseSyslogLine('2026-07-25 12:34:56.789 sub error: boom')?.level).toBe('error');
    expect(parseSyslogLine('2026-07-25 12:34:56.789 sub warn: careful')?.level).toBe('warn');
    expect(parseSyslogLine('2026-07-25 12:34:56.789 sub warning: careful')?.level).toBe('warning');
    expect(parseSyslogLine('2026-07-25 12:34:56.789 sub info: hi')?.level).toBe('info');
  });

  it('preserves multi-word messages after the level colon', () => {
    const parsed = parseSyslogLine('2026-07-25 12:34:56.789 sub error: multiple words here');
    expect(parsed?.text).toBe('multiple words here');
  });

  it('returns null when no level token is found', () => {
    expect(parseSyslogLine('this line has no level colon')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseSyslogLine('')).toBeNull();
  });
});
