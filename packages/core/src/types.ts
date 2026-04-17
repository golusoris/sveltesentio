export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = Error> = Ok<T> | Err<E>;

export type Some<T> = { readonly some: true; readonly value: T };
export type None = { readonly some: false };
export type Option<T> = Some<T> | None;

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type MaybePromise<T> = T | Promise<T>;

export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type NonEmptyArray<T> = [T, ...T[]];

export type Awaited<T> = T extends Promise<infer U> ? U : T;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function some<T>(value: T): Some<T> {
  return { some: true, value };
}

export const none: None = { some: false };

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

export function isSome<T>(option: Option<T>): option is Some<T> {
  return option.some;
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}
