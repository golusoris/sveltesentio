import { describe, it, expect } from 'vitest';
import {
  AppError,
  HttpError,
  ValidationError,
  isAppError,
  isHttpError,
  isValidationError,
  toAppError,
} from '../errors.js';

describe('AppError', () => {
  it('constructs with code, message, context', () => {
    const e = new AppError('NOT_FOUND', 'Item missing', { id: '123' });
    expect(e.code).toBe('NOT_FOUND');
    expect(e.message).toBe('Item missing');
    expect(e.context).toEqual({ id: '123' });
    expect(e instanceof Error).toBe(true);
    expect(e.name).toBe('AppError');
  });

  it('with() merges context into new error', () => {
    const e = new AppError('INTERNAL', 'Base').with({ requestId: 'abc' });
    expect(e.context).toEqual({ requestId: 'abc' });
    expect(e.code).toBe('INTERNAL');
  });

  it('toJSON() serializes correctly', () => {
    const e = new AppError('FORBIDDEN', 'No access');
    const j = e.toJSON();
    expect(j.code).toBe('FORBIDDEN');
    expect(j.name).toBe('AppError');
  });
});

describe('HttpError', () => {
  it('maps status 404 to NOT_FOUND code', () => {
    const e = new HttpError(404, 'Not found');
    expect(e.status).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
    expect(e instanceof AppError).toBe(true);
  });

  it('maps status 500 to INTERNAL code', () => {
    expect(new HttpError(500, 'Server error').code).toBe('INTERNAL');
  });

  it('unknown status maps to INTERNAL', () => {
    expect(new HttpError(418, "I'm a teapot").code).toBe('INTERNAL');
  });
});

describe('ValidationError', () => {
  it('stores issues array', () => {
    const e = new ValidationError([{ path: 'email', message: 'Invalid email' }]);
    expect(e.issues).toHaveLength(1);
    expect(e.code).toBe('UNPROCESSABLE');
    expect(e instanceof AppError).toBe(true);
  });
});

describe('type guards', () => {
  it('isAppError', () => {
    expect(isAppError(new AppError('INTERNAL', 'x'))).toBe(true);
    expect(isAppError(new HttpError(400, 'x'))).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError('string')).toBe(false);
  });

  it('isHttpError', () => {
    expect(isHttpError(new HttpError(400, 'x'))).toBe(true);
    expect(isHttpError(new AppError('INTERNAL', 'x'))).toBe(false);
  });

  it('isValidationError', () => {
    expect(isValidationError(new ValidationError([]))).toBe(true);
    expect(isValidationError(new AppError('INTERNAL', 'x'))).toBe(false);
  });
});

describe('toAppError', () => {
  it('passes AppError through unchanged', () => {
    const e = new AppError('INTERNAL', 'x');
    expect(toAppError(e)).toBe(e);
  });

  it('wraps plain Error', () => {
    const result = toAppError(new Error('plain'));
    expect(result.code).toBe('INTERNAL');
    expect(result.message).toBe('plain');
  });

  it('wraps string', () => {
    const result = toAppError('something went wrong');
    expect(result.message).toBe('something went wrong');
  });
});
