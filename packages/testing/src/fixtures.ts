// @sveltesentio/testing/fixtures — RFC 9457 ProblemError builders.
//
// Pure-function factories for the most common error shapes that appear in
// Golusoris-aligned APIs. Use directly in fetch mocks, MSW handlers, or as
// fixtures fed into `problemToFieldErrors()` round-trips.

import { ProblemError, type InvalidParam, type ProblemErrorInit } from '@sveltesentio/core';

export type FieldReasons = Readonly<Record<string, string | readonly string[]>>;

export interface ProblemBaseOptions {
	readonly type?: string;
	readonly title?: string;
	readonly status?: number;
	readonly detail?: string;
	readonly instance?: string;
	readonly extensions?: Readonly<Record<string, unknown>>;
}

export function problemError(init: ProblemErrorInit): ProblemError {
	return new ProblemError(init);
}

function fieldsToInvalidParams(fields: FieldReasons): InvalidParam[] {
	const out: InvalidParam[] = [];
	for (const [name, reasons] of Object.entries(fields)) {
		const list = typeof reasons === 'string' ? [reasons] : reasons;
		for (const reason of list) out.push({ name, reason });
	}
	return out;
}

interface ProblemDefaults {
	readonly type: string;
	readonly title: string;
	readonly status: number;
}

function buildProblem(
	defaults: ProblemDefaults,
	options: ProblemBaseOptions,
	extra?: Partial<ProblemErrorInit>,
): ProblemError {
	return new ProblemError({
		type: options.type ?? defaults.type,
		title: options.title ?? defaults.title,
		status: options.status ?? defaults.status,
		...(options.detail !== undefined ? { detail: options.detail } : {}),
		...(options.instance !== undefined ? { instance: options.instance } : {}),
		...(options.extensions !== undefined ? { extensions: options.extensions } : {}),
		...extra,
	});
}

const VALIDATION_DEFAULTS: ProblemDefaults = {
	type: 'https://golusoris.dev/problems/validation',
	title: 'Validation failed',
	status: 422,
};

const AUTH_DEFAULTS: ProblemDefaults = {
	type: 'https://golusoris.dev/problems/unauthenticated',
	title: 'Authentication required',
	status: 401,
};

const FORBIDDEN_DEFAULTS: ProblemDefaults = {
	type: 'https://golusoris.dev/problems/forbidden',
	title: 'Forbidden',
	status: 403,
};

const NOT_FOUND_DEFAULTS: ProblemDefaults = {
	type: 'https://golusoris.dev/problems/not-found',
	title: 'Resource not found',
	status: 404,
};

const RATE_LIMITED_DEFAULTS: ProblemDefaults = {
	type: 'https://golusoris.dev/problems/rate-limited',
	title: 'Too many requests',
	status: 429,
};

const SERVER_ERROR_DEFAULTS: ProblemDefaults = {
	type: 'about:blank',
	title: 'Internal server error',
	status: 500,
};

export interface ValidationProblemOptions extends ProblemBaseOptions {
	readonly fields: FieldReasons;
}

export function validationProblem(options: ValidationProblemOptions): ProblemError {
	return buildProblem(VALIDATION_DEFAULTS, options, {
		invalidParams: fieldsToInvalidParams(options.fields),
	});
}

export function authProblem(options: ProblemBaseOptions = {}): ProblemError {
	return buildProblem(AUTH_DEFAULTS, options);
}

export function forbiddenProblem(options: ProblemBaseOptions = {}): ProblemError {
	return buildProblem(FORBIDDEN_DEFAULTS, options);
}

export function notFoundProblem(options: ProblemBaseOptions = {}): ProblemError {
	return buildProblem(NOT_FOUND_DEFAULTS, options);
}

export function rateLimitedProblem(
	options: ProblemBaseOptions & { readonly retryAfterSeconds?: number } = {},
): ProblemError {
	const { retryAfterSeconds } = options;
	const extensions: Record<string, unknown> = {
		...(options.extensions ?? {}),
		...(retryAfterSeconds !== undefined ? { 'retry-after': retryAfterSeconds } : {}),
	};
	return buildProblem(RATE_LIMITED_DEFAULTS, options, { extensions });
}

export function serverErrorProblem(options: ProblemBaseOptions = {}): ProblemError {
	return buildProblem(SERVER_ERROR_DEFAULTS, options);
}

export interface ProblemResponseOptions {
	readonly headers?: Readonly<Record<string, string>>;
}

export function problemResponse(
	error: ProblemError,
	options: ProblemResponseOptions = {},
): Response {
	const status = error.status ?? 500;
	const headers = new Headers(options.headers);
	if (!headers.has('content-type')) {
		headers.set('content-type', 'application/problem+json');
	}
	return new Response(JSON.stringify(error.toJSON()), { status, headers });
}
