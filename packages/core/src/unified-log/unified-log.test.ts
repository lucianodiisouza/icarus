import { describe, expect, it } from 'vitest';
import type { CdpConsoleEntry } from '../protocol/cdp/console.js';
import { fuseCdp, fuseMetro, fuseNative, type UnifiedLogSource } from './unified-log-fuser.js';

const now = () => 1_700_000_000_000;

describe('unified-log fusers', () => {
  it('fuseCdp maps a CdpConsoleEntry to a unified entry with level "warn"', () => {
    const cdp: CdpConsoleEntry = { level: 'warning', text: 'careful', timestampMs: 42 };
    expect(fuseCdp(cdp)).toEqual({
      source: 'cdp',
      level: 'warn',
      text: 'careful',
      timestampMs: 42,
    });
  });

  it('fuseCdp defaults a missing level to "log"', () => {
    const cdp = { level: '', text: 'x', timestampMs: 1 } as unknown as CdpConsoleEntry;
    expect(fuseCdp(cdp).level).toBe('log');
  });

  it('fuseMetro maps a stdout Metro line to source=metro, level=info', () => {
    expect(fuseMetro({ stream: 'stdout', text: 'Welcome to Metro', timestampMs: 7 }, now)).toEqual({
      source: 'metro',
      level: 'info',
      text: 'Welcome to Metro',
      timestampMs: 7,
    });
  });

  it('fuseMetro maps a stderr Metro line to source=metro, level=warn', () => {
    const entry = fuseMetro(
      { stream: 'stderr', text: 'error: bundling failed', timestampMs: 8 },
      now,
    );
    expect(entry?.level).toBe('warn');
    expect(entry?.text).toBe('error: bundling failed');
  });

  it('fuseNative maps a syslog line to a unified entry', () => {
    const entry = fuseNative('com.apple.UIKit info: view appeared', now);
    expect(entry).toEqual({
      source: 'native' as UnifiedLogSource,
      level: 'info',
      text: 'view appeared',
      timestampMs: 1_700_000_000_000,
    });
  });

  it('fuseNative returns null for a line without a level token', () => {
    expect(fuseNative('just plain text with no colon', now)).toBeNull();
  });
});
