import { describe, it, expect } from 'vitest';
import { ok, err, some, none, isOk, isErr, isSome, unwrap, unwrapOr, mapResult } from '../types.js';

describe('Result', () => {
  it('ok() creates Ok variant', () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    expect((r as ReturnType<typeof ok>).value).toBe(42);
  });

  it('err() creates Err variant', () => {
    const r = err(new Error('fail'));
    expect(r.ok).toBe(false);
    expect((r as ReturnType<typeof err>).error.message).toBe('fail');
  });

  it('isOk / isErr narrow correctly', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isOk(err('x'))).toBe(false);
    expect(isErr(err('x'))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
  });

  it('unwrap() returns value on Ok', () => {
    expect(unwrap(ok('hello'))).toBe('hello');
  });

  it('unwrap() throws on Err', () => {
    expect(() => unwrap(err(new Error('boom')))).toThrow('boom');
  });

  it('unwrapOr() returns fallback on Err', () => {
    expect(unwrapOr(err('x'), 99)).toBe(99);
    expect(unwrapOr(ok(1), 99)).toBe(1);
  });

  it('mapResult() transforms Ok value', () => {
    const r = mapResult(ok(2), (v) => v * 3);
    expect(isOk(r) && r.value).toBe(6);
  });

  it('mapResult() passes through Err unchanged', () => {
    const e = err('fail');
    const r = mapResult(e, (v: number) => v * 3);
    expect(r).toBe(e);
  });
});

describe('Option', () => {
  it('some() and none work correctly', () => {
    expect(isSome(some(1))).toBe(true);
    expect(isSome(none)).toBe(false);
  });
});
