import { ProblemError } from '@sveltesentio/core';

/**
 * Typed MFA error codes emitted by the identity provider as RFC 9457 `type` URNs (ADR-0036).
 * The default namespace targets Golusoris; first-party providers may emit their own URNs,
 * which {@link handleAuthError} matches via {@link MfaErrorCodes}.
 */
export const MFA_REQUIRED = 'urn:golusoris:auth:mfa_required';
export const MFA_INVALID = 'urn:golusoris:auth:mfa_invalid';
export const MFA_RATE_LIMITED = 'urn:golusoris:auth:mfa_rate_limited';

/** Maps each MFA state to the accepted `ProblemError.type` URN(s). */
export interface MfaErrorCodes {
	required: readonly string[];
	invalid: readonly string[];
	rateLimited: readonly string[];
}

const DEFAULT_CODES: MfaErrorCodes = {
	required: [MFA_REQUIRED],
	invalid: [MFA_INVALID],
	rateLimited: [MFA_RATE_LIMITED],
};

/** Discriminated result of narrowing an auth error. `kind: 'other'` means it is not an MFA signal. */
export type AuthErrorState =
	| { kind: 'mfa-required'; allowedMethods: readonly string[]; error: ProblemError }
	| { kind: 'mfa-invalid'; error: ProblemError }
	| { kind: 'mfa-rate-limited'; retryAfter: number | undefined; error: ProblemError }
	| { kind: 'other'; error: unknown };

/**
 * Narrows an unknown auth error to a typed MFA state by matching the RFC 9457 `type` URN
 * — never by substring-matching the human message (the antipattern ADR-0036 replaces).
 */
export function handleAuthError(
	error: unknown,
	codes: MfaErrorCodes = DEFAULT_CODES,
): AuthErrorState {
	if (!(error instanceof ProblemError)) return { kind: 'other', error };

	if (codes.required.includes(error.type)) {
		return { kind: 'mfa-required', allowedMethods: readAllowedMethods(error), error };
	}
	if (codes.invalid.includes(error.type)) {
		return { kind: 'mfa-invalid', error };
	}
	if (codes.rateLimited.includes(error.type)) {
		return { kind: 'mfa-rate-limited', retryAfter: readRetryAfter(error), error };
	}
	return { kind: 'other', error };
}

/** Convenience predicate: is this error an MFA-required challenge? */
export function isMfaRequired(error: unknown, codes: MfaErrorCodes = DEFAULT_CODES): boolean {
	return handleAuthError(error, codes).kind === 'mfa-required';
}

function readAllowedMethods(error: ProblemError): readonly string[] {
	const value = error.extensions['allowedMethods'];
	if (Array.isArray(value)) {
		return value.filter((entry): entry is string => typeof entry === 'string');
	}
	return [];
}

function readRetryAfter(error: ProblemError): number | undefined {
	const value = error.extensions['retryAfter'];
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
