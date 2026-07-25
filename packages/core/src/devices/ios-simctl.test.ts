import { describe, expect, it } from 'vitest';
import { parseSimctlListDevices } from './ios-simctl.js';

const SAMPLE_JSON = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
      { udid: 'AAA-111', name: 'iPhone 17 Pro', state: 'Shutdown', isAvailable: true },
      { udid: 'AAA-222', name: 'iPhone 16', state: 'Booted', isAvailable: true },
    ],
    'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
      { udid: 'BBB-111', name: 'iPhone 15', state: 'Shutdown', isAvailable: false },
    ],
  },
});

describe('parseSimctlListDevices', () => {
  it('extracts every device keyed by runtime', () => {
    const devices = parseSimctlListDevices(SAMPLE_JSON);
    expect(devices).toHaveLength(3);
    const byUdid = new Map(devices.map((d) => [d.udid, d]));
    expect(byUdid.get('AAA-111')?.name).toBe('iPhone 17 Pro');
    expect(byUdid.get('AAA-111')?.state).toBe('Shutdown');
    expect(byUdid.get('AAA-111')?.runtime).toBe('com.apple.CoreSimulator.SimRuntime.iOS-18-0');
    expect(byUdid.get('AAA-111')?.isAvailable).toBe(true);
    expect(byUdid.get('AAA-222')?.state).toBe('Booted');
    // Unavailable devices are still parsed; the controller filters them.
    expect(byUdid.get('BBB-111')?.isAvailable).toBe(false);
  });

  it('returns [] for malformed JSON', () => {
    expect(parseSimctlListDevices('{ this is not json')).toEqual([]);
  });

  it('returns [] for empty / null payloads', () => {
    expect(parseSimctlListDevices('{}')).toEqual([]);
    expect(parseSimctlListDevices(JSON.stringify({ devices: {} }))).toEqual([]);
  });
});
