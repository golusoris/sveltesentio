// @sveltesentio/testing/fixtures — RFC 9457 ProblemError builders.
//
// Pure-function factories for the most common error shapes that appear in
// Golusoris-aligned APIs. Use directly in fetch mocks, MSW handlers, or as
// fixtures fed into `problemToFieldErrors()` round-trips.

import {
	ProblemError,
	type InvalidParam,
	type ProblemErrorInit,
} from '@sveltesentio/core';

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

export interface ValidationProblemOptions extends ProblemBaseOptions {
	readonly fields: FieldReasons;
}

export function validationProblem({
	fields,
	type = 'https://golusoris.dev/problems/validation',
	title = 'Validation failed',
	status = 422,
	detail,
	instance,
	extensions,
}: ValidationProblemOptions): ProblemError {
	return new ProblemError({
		type,
		title,
		status,
		...(detail !== undefined ? { detail } : {}),
		...(instance !== undefined ? { instance } : {}),
		invalidParams: fieldsToInvalidParams(fields),
		...(extensions !== undefined ? { extensions } : {}),
	});
}

export function authProblem({
	type = 'https://golusoris.dev/problems/unauthenticated',
	title = 'Authentication required',
	status = 401,
	detail,
	instance,
	extensions,
}: ProblemBaseOptions = {}): ProblemError {
	return new ProblemError({
		type,
		title,
		status,
		...(detail !== undefined ? { detail } : {}),
		...(instance !== undefined ? { instance } : {}),
		...(extensions !== undefined ? { extensions } : {}),
	});
}

export function forbiddenProblem({
	type = 'https://golusoris.dev/problems/forbidden',
	title = 'Forbidden',
	status = 403,
	detail,
	instance,
	extensions,
}: ProblemBaseOptions = {}): ProblemError {
	return new ProblemError({
		type,
		title,
		status,
		...(detail !== undefined ? { detail } : {}),
		...(instance !== undefined ? { instance } : {}),
		...(extensions !== undefined ? { extensions } : {}),
	});
}

export function notFoundProblem({
	type = 'https://golusoris.dev/problems/not-found',
	title = 'Resource not found',
	status = 404,
	detail,
	instance,
	extensions,
}: ProblemBaseOptions = {}): ProblemError {
	return new ProblemError({
		type,
		title,
		status,
		...(detail !== undefined ? { detail } : {}),
		...(instance !== undefined ? { instance } : {}),
		...(extensions !== undefined ? { extensions } : {}),
	});
}

export function rateLimitedProblem({
	type = 'https://golusoris.dev/problems/rate-limited',
	title = 'Too many requests',
	status = 429,
	detail,
	instance,
	extensions,
	retryAfterSeconds,
}: ProblemBaseOptions & { readonly retryAfterSeconds?: number } = {}): ProblemError {
	const ext: Record<string, unknown> = { ...(extensions ?? {}) };
	if (retryAfterSeconds !== undefined) ext['retry-after'] = retryAfterSeconds;
	return new ProblemError({
		type,
		title,
		status,
		...(detail !== undefined ? { detail } : {}),
		...(instance !== undefined ? { instance } : {}),
		extensions: ext,
	});
}

export function serverErrorProblem({
	type = 'about:blank',
	title = 'Internal server error',
	status = 500,
	detail,
	instance,
	extensions,
}: ProblemBaseOptions = {}): ProblemError {
	return new ProblemError({
		type,
		title,
		status,
		...(detail !== undefined ? { detail } : {}),
		...(instance !== undefined ? { instance } : {}),
		...(extensions !== undefined ? { extensions } : {}),
	});
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
