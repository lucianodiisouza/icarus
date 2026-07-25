import { describe, expect, it } from 'vitest';
import { formatConsoleEvent, previewRemoteObject } from './console.js';

const now = () => 1_000_000;

describe('previewRemoteObject', () => {
  it('renders primitives, descriptions, and falls back to type', () => {
    expect(previewRemoteObject({ type: 'string', value: 'hi' })).toBe('hi');
    expect(previewRemoteObject({ type: 'number', value: 42 })).toBe('42');
    expect(previewRemoteObject({ type: 'object', description: 'Array(3)' })).toBe('Array(3)');
    expect(previewRemoteObject({ type: 'undefined' })).toBe('undefined');
    expect(previewRemoteObject({ type: 'number', unserializableValue: 'Infinity' })).toBe(
      'Infinity',
    );
  });
});

describe('formatConsoleEvent', () => {
  it('flattens args and captures the level and timestamp', () => {
    const entry = formatConsoleEvent(
      {
        type: 'warning',
        timestamp: 123456,
        args: [
          { type: 'string', value: 'ICARUS_PROBE' },
          { type: 'number', value: 7 },
        ],
      },
      now,
    );
    expect(entry).toEqual({ level: 'warning', text: 'ICARUS_PROBE 7', timestampMs: 123456 });
  });

  it('defaults level to log and timestamp to now when absent', () => {
    const entry = formatConsoleEvent({ args: [{ type: 'string', value: 'x' }] }, now);
    expect(entry).toEqual({ level: 'log', text: 'x', timestampMs: 1_000_000 });
  });

  it('returns null for non-object params (never throws)', () => {
    expect(formatConsoleEvent(null)).toBeNull();
    expect(formatConsoleEvent('nope')).toBeNull();
  });

  it('handles missing args gracefully', () => {
    expect(formatConsoleEvent({ type: 'error' }, now)).toEqual({
      level: 'error',
      text: '',
      timestampMs: 1_000_000,
    });
  });
});
