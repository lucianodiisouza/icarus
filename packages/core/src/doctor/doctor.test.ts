import { describe, expect, it } from 'vitest';
import { parseVersion, runDoctor } from './doctor.js';
import type { ToolProbeResult, ToolRunner } from './types.js';

/** A deterministic fake runner driven by a lookup table. */
function fakeRunner(platform: NodeJS.Platform, table: Record<string, ToolProbeResult>): ToolRunner {
  return {
    platform,
    async probe(command) {
      return table[command] ?? { path: null, versionOutput: null };
    },
  };
}

const found = (path: string, versionOutput: string): ToolProbeResult => ({ path, versionOutput });
const missing: ToolProbeResult = { path: null, versionOutput: null };

describe('parseVersion', () => {
  it('extracts a semver-ish version from noisy output', () => {
    expect(parseVersion('v22.19.0')).toBe('22.19.0');
    expect(parseVersion('watchman 2024.01.01.00')).toBe('2024.01.01');
    expect(parseVersion('Android Debug Bridge version 1.0.41')).toBe('1.0.41');
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion('no numbers here')).toBeNull();
  });
});

describe('runDoctor', () => {
  const clock = () => new Date('2026-07-25T00:00:00.000Z');

  it('reports ok overall when required + recommended tools are present and current', async () => {
    const runner = fakeRunner('darwin', {
      node: found('/usr/bin/node', 'v22.19.0'),
      watchman: found('/opt/homebrew/bin/watchman', '2024.01.01.00'),
      adb: found('/usr/bin/adb', 'Android Debug Bridge version 1.0.41'),
      xcrun: found('/usr/bin/xcrun', 'xcrun version 70.'),
    });

    const report = await runDoctor({ runner, now: clock });

    expect(report.overall).toBe('ok');
    expect(report.platform).toBe('darwin');
    expect(report.generatedAt).toBe('2026-07-25T00:00:00.000Z');
    const node = report.checks.find((c) => c.id === 'node');
    expect(node?.status).toBe('ok');
    expect(node?.version).toBe('22.19.0');
    expect(node?.path).toBe('/usr/bin/node');
  });

  it('errors overall when a required tool (node) is missing, with a remedy', async () => {
    const runner = fakeRunner('darwin', {
      node: missing,
      watchman: found('/x/watchman', '2024.01.01.00'),
    });

    const report = await runDoctor({ runner, now: clock });

    expect(report.overall).toBe('error');
    const node = report.checks.find((c) => c.id === 'node');
    expect(node?.status).toBe('not-found');
    expect(node?.remedy).toContain('Node.js');
  });

  it('warns overall when only a recommended tool is missing', async () => {
    const runner = fakeRunner('darwin', {
      node: found('/usr/bin/node', 'v22.19.0'),
      // watchman/adb/xcrun missing
    });

    const report = await runDoctor({ runner, now: clock });

    expect(report.overall).toBe('warn');
    expect(report.checks.find((c) => c.id === 'watchman')?.status).toBe('not-found');
  });

  it('flags an outdated required tool below the version floor', async () => {
    const runner = fakeRunner('darwin', {
      node: found('/usr/bin/node', 'v18.20.0'),
    });

    const report = await runDoctor({ runner, now: clock });

    const node = report.checks.find((c) => c.id === 'node');
    expect(node?.status).toBe('outdated');
    expect(node?.detail).toContain('>= 22');
    expect(report.overall).toBe('error');
  });

  it('reports platform-gated tools (xcrun) as info on non-darwin, not a failure', async () => {
    const runner = fakeRunner('linux', {
      node: found('/usr/bin/node', 'v22.19.0'),
      watchman: found('/x/watchman', '2024.01.01.00'),
      adb: found('/x/adb', 'version 1.0.41'),
    });

    const report = await runDoctor({ runner, now: clock });

    const xcrun = report.checks.find((c) => c.id === 'xcrun');
    expect(xcrun?.severity).toBe('info');
    expect(xcrun?.status).toBe('ok');
    expect(report.overall).toBe('ok');
  });

  it('never throws when a tool is absent', async () => {
    const runner = fakeRunner('linux', {});
    await expect(runDoctor({ runner, now: clock })).resolves.toBeDefined();
  });
});
