import type { AuthErrorState } from './mfa.js';

/**
 * Default user-facing copy for each MFA challenge state. Apps override any field
 * via the `copy` prop on `<MfaChallenge>`; the framework never branches on these
 * strings (the typed `AuthErrorState.kind` is the source of truth — ADR-0036).
 */
export interface MfaChallengeCopy {
	/** Heading shown above the code input. */
	heading: string;
	/** Instruction shown when a fresh challenge is presented (`mfa-required`). */
	prompt: string;
	/** Error shown when the entered code was rejected (`mfa-invalid`). */
	invalid: string;
	/** Error shown when the server rate-limited the attempts (`mfa-rate-limited`). */
	rateLimited: string;
	/** Suffix appended to {@link rateLimited} when a `retryAfter` is known. */
	retryAfterSuffix: string;
}

export const DEFAULT_MFA_CHALLENGE_COPY: MfaChallengeCopy = {
	heading: 'Two-factor authentication',
	prompt: 'Enter the 6-digit code from your authenticator app.',
	invalid: 'That code was incorrect. Try again.',
	rateLimited: 'Too many attempts. Wait before trying again.',
	retryAfterSuffix: 'Try again in {seconds} seconds.',
};

/**
 * Pure presentation model derived from a narrowed {@link AuthErrorState}. The
 * `.svelte` component is a thin renderer over this — all branching lives here so
 * it can be unit-tested without a DOM (repo precedent: `.svelte` stays untested).
 */
export interface MfaChallengeView {
	/** Heading text. */
	heading: string;
	/** Instruction text shown beneath the heading. */
	prompt: string;
	/** Error message, or `undefined` when there is nothing to announce. */
	error: string | undefined;
	/** Whether the error region carries an active error (drives `aria-live`). */
	hasError: boolean;
	/** Whether the submit control + input must be disabled (rate-limited). */
	disabled: boolean;
	/** Seconds until retry is allowed, when the server supplied one. */
	retryAfter: number | undefined;
}

function formatRetryAfter(template: string, seconds: number): string {
	return template.replace('{seconds}', String(seconds));
}

/**
 * Derives the {@link MfaChallengeView} for a given auth-error state and copy.
 * `mfa-required` shows the prompt with no error; `mfa-invalid` surfaces the
 * rejection; `mfa-rate-limited` disables the form and appends the retry window
 * when known. `other` is treated as a fresh challenge with no error.
 */
export function deriveMfaChallengeView(
	state: AuthErrorState,
	copy: MfaChallengeCopy = DEFAULT_MFA_CHALLENGE_COPY,
): MfaChallengeView {
	const base = { heading: copy.heading, prompt: copy.prompt } as const;

	switch (state.kind) {
		case 'mfa-invalid':
			return { ...base, error: copy.invalid, hasError: true, disabled: false, retryAfter: undefined };
		case 'mfa-rate-limited': {
			const error =
				state.retryAfter === undefined
					? copy.rateLimited
					: `${copy.rateLimited} ${formatRetryAfter(copy.retryAfterSuffix, state.retryAfter)}`;
			return { ...base, error, hasError: true, disabled: true, retryAfter: state.retryAfter };
		}
		case 'mfa-required':
		case 'other':
			return { ...base, error: undefined, hasError: false, disabled: false, retryAfter: undefined };
	}
}

/** Returns `true` when `code` is a plausible OTP to submit (non-empty digits). */
export function isSubmittableCode(code: string): boolean {
	return /^\d{4,}$/.test(code.trim());
}

/** Submission callback for `<MfaChallenge>` / `<MfaEnroll>` — the caller owns the request. */
export type MfaCodeSubmit = (code: string) => void;

/** Optional resend callback for `<MfaChallenge>`. */
export type MfaResend = () => void;
