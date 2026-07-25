import { describe, expect, it, vi } from 'vitest';
import { LineStream } from './line-stream.js';

describe('LineStream', () => {
  it('emits complete lines and buffers the partial remainder', () => {
    const stream = new LineStream();
    const seen: string[] = [];
    stream.onLine((l) => seen.push(l));

    stream.push('hello\nwor');
    expect(seen).toEqual(['hello']);
    stream.push('ld\n');
    expect(seen).toEqual(['hello', 'world']);
  });

  it('strips a trailing carriage return (CRLF)', () => {
    const stream = new LineStream();
    const seen: string[] = [];
    stream.onLine((l) => seen.push(l));
    stream.push('a\r\nb\r\n');
    expect(seen).toEqual(['a', 'b']);
  });

  it('flushes a trailing partial line on close', () => {
    const stream = new LineStream();
    const seen: string[] = [];
    stream.onLine((l) => seen.push(l));
    stream.push('no newline');
    expect(seen).toEqual([]);
    stream.close();
    expect(seen).toEqual(['no newline']);
  });

  it('bounds the retained buffer and counts drops', () => {
    const stream = new LineStream(3);
    for (let i = 1; i <= 10; i++) stream.push(`line${i}\n`);
    expect(stream.lines()).toEqual(['line8', 'line9', 'line10']);
    expect(stream.droppedCount()).toBe(7);
  });

  it('ignores input after close', () => {
    const stream = new LineStream();
    const handler = vi.fn();
    stream.onLine(handler);
    stream.close();
    stream.push('late\n');
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe stops line delivery', () => {
    const stream = new LineStream();
    const handler = vi.fn();
    const off = stream.onLine(handler);
    stream.push('a\n');
    off();
    stream.push('b\n');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
