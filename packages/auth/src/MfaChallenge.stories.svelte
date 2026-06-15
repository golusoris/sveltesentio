<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { ProblemError } from '@sveltesentio/core';
	import MfaChallenge from './MfaChallenge.svelte';
	import { MFA_REQUIRED, MFA_INVALID, MFA_RATE_LIMITED } from './mfa.js';
	import type { AuthErrorState } from './mfa.js';

	// The component owns no network: stories pass realistic `AuthErrorState`
	// values (built from the same `ProblemError` URNs the IdP emits) and no-op
	// handlers. `onSubmit`/`onResend` are wired to the Storybook actions panel.
	function logSubmit(code: string): void {
		console.warn('[MfaChallenge] onSubmit', code);
	}
	function logResend(): void {
		console.warn('[MfaChallenge] onResend');
	}

	// `handleAuthError()` produces these in an app; we construct them directly so
	// each story renders a deterministic state.
	const requiredState: AuthErrorState = {
		kind: 'mfa-required',
		allowedMethods: ['totp'],
		error: new ProblemError({ type: MFA_REQUIRED, title: 'MFA required', status: 401 }),
	};

	const invalidState: AuthErrorState = {
		kind: 'mfa-invalid',
		error: new ProblemError({ type: MFA_INVALID, title: 'Invalid code', status: 401 }),
	};

	const rateLimitedState: AuthErrorState = {
		kind: 'mfa-rate-limited',
		retryAfter: 30,
		error: new ProblemError({
			type: MFA_RATE_LIMITED,
			title: 'Too many attempts',
			status: 429,
			extensions: { retryAfter: 30 },
		}),
	};

	const { Story } = defineMeta({
		title: 'auth/MfaChallenge',
		component: MfaChallenge,
		tags: ['autodocs'],
		argTypes: {
			pending: { control: 'boolean' },
			idBase: { control: 'text' },
		},
		args: {
			errorState: requiredState,
			onSubmit: logSubmit,
			pending: false,
		},
	});
</script>

<!-- Fresh challenge: prompt only, no error region content. -->
<Story name="Required" args={{ errorState: requiredState, onSubmit: logSubmit }} />

<!-- A "resend code" control appears whenever an `onResend` handler is supplied. -->
<Story
	name="With resend"
	args={{ errorState: requiredState, onSubmit: logSubmit, onResend: logResend }}
/>

<!-- Rejected code: the `aria-live` region announces the failure. -->
<Story name="Invalid code" args={{ errorState: invalidState, onSubmit: logSubmit }} />

<!-- Rate-limited: input + buttons disabled, retry window appended to the message. -->
<Story
	name="Rate limited"
	args={{ errorState: rateLimitedState, onSubmit: logSubmit, onResend: logResend }}
/>

<!-- Submission in flight: input + buttons disabled, submit reads "Verifying…". -->
<Story
	name="Pending"
	args={{ errorState: requiredState, onSubmit: logSubmit, pending: true }}
/>
