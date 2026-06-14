import { ProblemError } from '@sveltesentio/core';
import { describe, expect, it } from 'vitest';
import { handleAuthError, MFA_INVALID, MFA_RATE_LIMITED, MFA_REQUIRED } from '../src/mfa.js';
import {
	DEFAULT_MFA_CHALLENGE_COPY,
	deriveMfaChallengeView,
	isSubmittableCode,
	type MfaChallengeCopy,
} from '../src/mfa-view.js';

const view = (error: unknown, copy?: MfaChallengeCopy) =>
	deriveMfaChallengeView(handleAuthError(error), copy);

describe('deriveMfaChallengeView', () => {
	it('mfa-required shows the prompt with no error', () => {
		const v = view(new ProblemError({ type: MFA_REQUIRED, status: 401 }));
		expect(v.heading).toBe(DEFAULT_MFA_CHALLENGE_COPY.heading);
		expect(v.prompt).toBe(DEFAULT_MFA_CHALLENGE_COPY.prompt);
		expect(v.hasError).toBe(false);
		expect(v.error).toBeUndefined();
		expect(v.disabled).toBe(false);
		expect(v.retryAfter).toBeUndefined();
	});

	it('mfa-invalid surfaces the rejection and keeps the form enabled', () => {
		const v = view(new ProblemError({ type: MFA_INVALID, status: 401 }));
		expect(v.hasError).toBe(true);
		expect(v.error).toBe(DEFAULT_MFA_CHALLENGE_COPY.invalid);
		expect(v.disabled).toBe(false);
	});

	it('mfa-rate-limited disables the form and appends the retry window when known', () => {
		const v = view(
			new ProblemError({ type: MFA_RATE_LIMITED, status: 429, extensions: { retryAfter: 30 } }),
		);
		expect(v.hasError).toBe(true);
		expect(v.disabled).toBe(true);
		expect(v.retryAfter).toBe(30);
		expect(v.error).toContain('30');
		expect(v.error).toContain(DEFAULT_MFA_CHALLENGE_COPY.rateLimited);
	});

	it('mfa-rate-limited without a retryAfter shows the base message only', () => {
		const v = view(new ProblemError({ type: MFA_RATE_LIMITED, status: 429 }));
		expect(v.disabled).toBe(true);
		expect(v.error).toBe(DEFAULT_MFA_CHALLENGE_COPY.rateLimited);
		expect(v.retryAfter).toBeUndefined();
	});

	it('non-MFA (other) state is treated as a fresh challenge with no error', () => {
		const v = view(new Error('mfa totp required please'));
		expect(v.hasError).toBe(false);
		expect(v.error).toBeUndefined();
		expect(v.disabled).toBe(false);
	});

	it('respects overridden copy and interpolates {seconds}', () => {
		const copy: MfaChallengeCopy = {
			heading: 'Zwei-Faktor',
			prompt: 'Code eingeben.',
			invalid: 'Falsch.',
			rateLimited: 'Zu viele Versuche.',
			retryAfterSuffix: 'Warte {seconds}s.',
		};
		const v = view(
			new ProblemError({ type: MFA_RATE_LIMITED, status: 429, extensions: { retryAfter: 12 } }),
			copy,
		);
		expect(v.heading).toBe('Zwei-Faktor');
		expect(v.error).toBe('Zu viele Versuche. Warte 12s.');
	});
});

describe('isSubmittableCode', () => {
	it('accepts 4+ digit codes, trimming surrounding whitespace', () => {
		expect(isSubmittableCode('123456')).toBe(true);
		expect(isSubmittableCode('  654321 ')).toBe(true);
		expect(isSubmittableCode('1234')).toBe(true);
	});

	it('rejects short, empty, or non-numeric input', () => {
		expect(isSubmittableCode('')).toBe(false);
		expect(isSubmittableCode('12')).toBe(false);
		expect(isSubmittableCode('12 34')).toBe(false);
		expect(isSubmittableCode('abcdef')).toBe(false);
		expect(isSubmittableCode('12a456')).toBe(false);
	});
});
