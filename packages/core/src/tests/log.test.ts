import { describe, it, expect } from 'vitest';
import { createLogger, createTestLogger, type LogEntry } from '../log.js';

describe('createTestLogger', () => {
  it('captures all log levels', () => {
    const logger = createTestLogger('test');
    logger.debug('a debug message');
    logger.info('an info message');
    logger.warn('a warning', { key: 'value' });
    logger.error('an error');
    expect(logger.entries).toHaveLength(4);
    expect(logger.entries[0]?.level).toBe('debug');
    expect(logger.entries[2]?.context).toEqual({ key: 'value' });
  });

  it('includes name and timestamp in entries', () => {
    const logger = createTestLogger('mymodule');
    logger.info('hello');
    expect(logger.entries[0]?.name).toBe('mymodule');
    expect(logger.entries[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('message field is set correctly', () => {
    const logger = createTestLogger('x');
    logger.warn('something happened');
    expect(logger.entries[0]?.message).toBe('something happened');
  });
});

describe('child logger', () => {
  it('prefixes name with parent:child', () => {
    const entries: LogEntry[] = [];
    const parent = createLogger('root', {
      level: 'debug',
      sink: (e) => entries.push(e),
    });
    const child = parent.child('service');
    child.info('hello from child');
    expect(entries[0]?.name).toBe('root:service');
  });

  it('nested children accumulate prefixes', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger('a', {
      level: 'debug',
      sink: (e) => entries.push(e),
    });
    logger.child('b').child('c').warn('deep');
    expect(entries[0]?.name).toBe('a:b:c');
  });
});

describe('createLogger level filtering', () => {
  it('silences levels below min', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger('x', {
      level: 'warn',
      sink: (e) => entries.push(e),
    });
    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');
    expect(entries).toHaveLength(2);
    expect(entries[0]?.level).toBe('warn');
    expect(entries[1]?.level).toBe('error');
  });

  it('debug level emits everything', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger('x', { level: 'debug', sink: (e) => entries.push(e) });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(entries).toHaveLength(4);
  });
});
