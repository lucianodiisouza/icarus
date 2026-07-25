import { describe, expect, it } from 'vitest';
import { Logger, type LogRecord } from './logger.js';

function capture() {
  const records: LogRecord[] = [];
  const logger = new Logger({
    scope: 'test',
    minLevel: 'debug',
    sink: (r) => records.push(r),
    now: () => new Date('2026-07-25T00:00:00.000Z'),
  });
  return { logger, records };
}

describe('Logger', () => {
  it('emits a structured record with scope, level, message and time', () => {
    const { logger, records } = capture();
    logger.info('hello', { a: 1 });

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      level: 'info',
      scope: 'test',
      message: 'hello',
      time: '2026-07-25T00:00:00.000Z',
      data: { a: 1 },
    });
  });

  it('omits data when none is given', () => {
    const { logger, records } = capture();
    logger.warn('careful');
    expect(records[0]).not.toHaveProperty('data');
  });

  it('filters records below the minimum level', () => {
    const records: LogRecord[] = [];
    const logger = new Logger({ scope: 't', minLevel: 'warn', sink: (r) => records.push(r) });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(records.map((r) => r.level)).toEqual(['warn', 'error']);
  });

  it('child loggers nest the scope', () => {
    const { logger, records } = capture();
    logger.child('metro').info('up');
    expect(records[0]?.scope).toBe('test:metro');
  });
});
