import { describe, expect, it } from 'vitest';
import { parseAdbDevices } from './android-adb.js';

describe('parseAdbDevices', () => {
  it('parses a single emulator row with model/product/transport_id', () => {
    const out = parseAdbDevices(
      'List of devices attached\nemulator-5554\tdevice product:sdk_phone64_arm64 model:sdk_google_phone_arm64 device:emu64a transport_id:1\n\n',
    );
    expect(out).toEqual([
      {
        serial: 'emulator-5554',
        state: 'device',
        model: 'sdk_google_phone_arm64',
        product: 'sdk_phone64_arm64',
        transportId: '1',
        family: 'android',
      },
    ]);
  });

  it('parses a physical device with hex serial', () => {
    const out = parseAdbDevices(
      'List of devices attached\n014e23a0c123\tdevice product:panther model:Pixel_7 device:panther transport_id:2\n',
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.serial).toBe('014e23a0c123');
    expect(out[0]?.model).toBe('Pixel_7');
    expect(out[0]?.family).toBe('android');
  });

  it('parses multiple rows', () => {
    const out = parseAdbDevices(
      'List of devices attached\nemulator-5554\tdevice model:sdk_google_phone_arm64\n014e23a0c123\tdevice model:Pixel_7\n\n',
    );
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.serial).sort()).toEqual(['014e23a0c123', 'emulator-5554']);
  });

  it('skips offline / unauthorized / no permissions rows', () => {
    const out = parseAdbDevices(
      'List of devices attached\nemulator-5554\toffline\ndeadbeef\tunauthorized\ncafebabe\tno permissions\nemulator-5556\tdevice model:foo\n',
    );
    expect(out.map((d) => d.serial)).toEqual(['emulator-5556']);
  });

  it('skips daemon advisory lines and the "List of devices" header', () => {
    const out = parseAdbDevices(
      '* daemon not running. starting it now at tcp:5037\n* daemon started successfully\nList of devices attached\nemulator-5554\tdevice model:foo\n',
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.serial).toBe('emulator-5554');
  });

  it('tolerates a row with no model/product/transport_id (older adb)', () => {
    const out = parseAdbDevices('List of devices attached\nemulator-5554\tdevice\n');
    expect(out).toEqual([
      {
        serial: 'emulator-5554',
        state: 'device',
        model: null,
        product: null,
        transportId: null,
        family: 'android',
      },
    ]);
  });

  it('returns [] on empty / non-matching input', () => {
    expect(parseAdbDevices('')).toEqual([]);
    expect(parseAdbDevices('List of devices attached\n\n')).toEqual([]);
    expect(parseAdbDevices('garbage with no header')).toEqual([]);
  });

  it('handles CRLF line endings (Windows adb output)', () => {
    const out = parseAdbDevices(
      'List of devices attached\r\nemulator-5554\tdevice model:foo\r\n\r\n',
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.serial).toBe('emulator-5554');
  });

  it('every row carries family="android"', () => {
    const out = parseAdbDevices(
      'List of devices attached\nemulator-5554\tdevice model:a\nemulator-5556\tdevice model:b\n',
    );
    for (const d of out) {
      expect(d.family).toBe('android');
    }
  });
});
