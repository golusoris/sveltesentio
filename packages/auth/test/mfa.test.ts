import { ProblemError } from '@sveltesentio/core';
import { describe, expect, it } from 'vitest';
import {
	MFA_INVALID,
	MFA_RATE_LIMITED,
	MFA_REQUIRED,
	handleAuthError,
	isMfaRequired,
} from '../src/mfa.js';

describe('handleAuthError', () => {
	it('narrows mfa_required and surfaces allowedMethods from extensions', () => {
		const error = new ProblemError({
			type: MFA_REQUIRED,
			status: 401,
			extensions: { allowedMethods: ['totp', 'webauthn', 42] },
		});
		const state = handleAuthError(error);
		expect(state.kind).toBe('mfa-required');
		if (state.kind === 'mfa-required') {
			expect(state.allowedMethods).toEqual(['totp', 'webauthn']);
			expect(state.error).toBe(error);
		}
	});

	it('narrows mfa_invalid', () => {
		const error = new ProblemError({ type: MFA_INVALID, status: 401 });
		expect(handleAuthError(error).kind).toBe('mfa-invalid');
	});

	it('narrows mfa_rate_limited and reads retryAfter', () => {
		const error = new ProblemError({
			type: MFA_RATE_LIMITED,
			status: 429,
			extensions: { retryAfter: 30 },
		});
		const state = handleAuthError(error);
		expect(state.kind).toBe('mfa-rate-limited');
		if (state.kind === 'mfa-rate-limited') expect(state.retryAfter).toBe(30);
	});

	it('returns other for an unrelated ProblemError type', () => {
		const error = new ProblemError({ type: 'urn:golusoris:auth:invalid_credentials', status: 401 });
		expect(handleAuthError(error).kind).toBe('other');
	});

	it('returns other for a non-ProblemError value and never substring-matches the message', () => {
		const plain = new Error('mfa totp required please');
		const state = handleAuthError(plain);
		expect(state.kind).toBe('other');
		if (state.kind === 'other') expect(state.error).toBe(plain);
	});

	it('supports custom first-party error codes', () => {
		const codes = {
			required: ['urn:revenge:auth:mfa'],
			invalid: ['urn:revenge:auth:mfa_bad'],
			rateLimited: ['urn:revenge:auth:mfa_slow'],
		};
		const error = new ProblemError({ type: 'urn:revenge:auth:mfa', status: 401 });
		expect(handleAuthError(error, codes).kind).toBe('mfa-required');
		expect(handleAuthError(error).kind).toBe('other');
	});

	it('defaults allowedMethods to empty when the extension is absent or wrong-typed', () => {
		const error = new ProblemError({ type: MFA_REQUIRED, extensions: { allowedMethods: 'totp' } });
		const state = handleAuthError(error);
		if (state.kind === 'mfa-required') expect(state.allowedMethods).toEqual([]);
	});
});

describe('isMfaRequired', () => {
	it('is true only for the required code', () => {
		expect(isMfaRequired(new ProblemError({ type: MFA_REQUIRED }))).toBe(true);
		expect(isMfaRequired(new ProblemError({ type: MFA_INVALID }))).toBe(false);
		expect(isMfaRequired(new Error('mfa'))).toBe(false);
	});
});
