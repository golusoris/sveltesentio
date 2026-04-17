export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | (string & {});

export interface ErrorContext {
  readonly [key: string]: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly context: ErrorContext;

  constructor(code: ErrorCode, message: string, context: ErrorContext = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.context = context;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  with(context: ErrorContext): AppError {
    return new AppError(this.code, this.message, { ...this.context, ...context });
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, message: this.message, context: this.context };
  }
}

export class HttpError extends AppError {
  readonly status: number;

  constructor(status: number, message: string, context: ErrorContext = {}) {
    super(httpStatusToCode(status), message, context);
    this.name = 'HttpError';
    this.status = status;
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), status: this.status };
  }
}

export class ValidationError extends AppError {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(
    issues: ReadonlyArray<{ path: string; message: string }>,
    context: ErrorContext = {},
  ) {
    super('UNPROCESSABLE', 'Validation failed', context);
    this.name = 'ValidationError';
    this.issues = issues;
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), issues: this.issues };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}

export function isValidationError(value: unknown): value is ValidationError {
  return value instanceof ValidationError;
}

export function toAppError(value: unknown): AppError {
  if (value instanceof AppError) return value;
  if (value instanceof Error) return new AppError('INTERNAL', value.message);
  return new AppError('INTERNAL', String(value));
}

function httpStatusToCode(status: number): ErrorCode {
  const map: Record<number, ErrorCode> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE',
    429: 'RATE_LIMITED',
    500: 'INTERNAL',
    503: 'UNAVAILABLE',
    504: 'TIMEOUT',
  };
  return map[status] ?? 'INTERNAL';
}
