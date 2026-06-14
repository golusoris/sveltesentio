<!--
@component
MfaChallenge — accessible TOTP/OTP challenge UI driven by the typed
`AuthErrorState` from `handleAuthError()` (ADR-0036). It NEVER substring-matches
an error message; the visible state is derived from `state.kind` via the pure,
unit-tested `deriveMfaChallengeView()` in `./mfa-view`.

Callback-driven — the component owns no network. The caller submits the code and
passes the resulting `AuthErrorState` back in via the `state` prop; on an
`mfa-invalid` / `mfa-rate-limited` state the error region announces it.

WCAG 2.2 AA:
- The code `<input>` is labelled, `inputmode="numeric"`, `autocomplete="one-time-code"`.
- The error region is `aria-live="assertive"` and wired to the input via `aria-describedby`.
- The input is focused on mount and disabled while pending or rate-limited.

Plain `tsc` does not type-check `.svelte`; the typed core lives in `./mfa-view`
and is unit-tested there.
-->
<script lang="ts">
	import {
		deriveMfaChallengeView,
		isSubmittableCode,
		DEFAULT_MFA_CHALLENGE_COPY,
		type MfaChallengeCopy,
		type MfaCodeSubmit,
		type MfaResend,
	} from './mfa-view.js';
	import type { AuthErrorState } from './mfa.js';

	interface Props {
		/** Narrowed auth-error state from `handleAuthError()`; drives the view. */
		errorState: AuthErrorState;
		/** Called with the entered code when the form is submitted. Caller owns the request. */
		onSubmit: MfaCodeSubmit;
		/** Optional resend handler; when supplied a "resend" control is rendered. */
		onResend?: MfaResend | undefined;
		/** Whether a submission is in flight; disables input + buttons. */
		pending?: boolean;
		/** Override user-facing copy (apps localise here; the framework never branches on strings). */
		copy?: MfaChallengeCopy;
		/** Stable id prefix for aria wiring. */
		idBase?: string;
	}

	const {
		errorState,
		onSubmit,
		onResend,
		pending = false,
		copy = DEFAULT_MFA_CHALLENGE_COPY,
		idBase = 'mfa-challenge',
	}: Props = $props();

	let code = $state('');
	let input = $state<HTMLInputElement | null>(null);

	const view = $derived(deriveMfaChallengeView(errorState, copy));
	const headingId = $derived(`${idBase}-heading`);
	const inputId = $derived(`${idBase}-code`);
	const errorId = $derived(`${idBase}-error`);
	const promptId = $derived(`${idBase}-prompt`);

	const isDisabled = $derived(pending || view.disabled);
	const canSubmit = $derived(!isDisabled && isSubmittableCode(code));
	const describedBy = $derived(view.hasError ? `${promptId} ${errorId}` : promptId);

	$effect(() => {
		input?.focus();
	});

	function handleSubmit(event: SubmitEvent): void {
		event.preventDefault();
		if (!canSubmit) return;
		onSubmit(code.trim());
	}
</script>

<section class="ssentio-mfa" aria-labelledby={headingId}>
	<h2 id={headingId} class="ssentio-mfa__heading">{view.heading}</h2>
	<p id={promptId} class="ssentio-mfa__prompt">{view.prompt}</p>

	<form class="ssentio-mfa__form" onsubmit={handleSubmit}>
		<label class="ssentio-mfa__label" for={inputId}>{view.heading}</label>
		<input
			bind:this={input}
			bind:value={code}
			id={inputId}
			class="ssentio-mfa__input"
			type="text"
			inputmode="numeric"
			autocomplete="one-time-code"
			pattern="[0-9]*"
			spellcheck="false"
			autocapitalize="off"
			aria-describedby={describedBy}
			aria-invalid={view.hasError}
			disabled={isDisabled}
		/>

		<div class="ssentio-mfa__actions">
			<button class="ssentio-mfa__submit" type="submit" disabled={!canSubmit}>
				{pending ? 'Verifying…' : 'Verify'}
			</button>
			{#if onResend}
				<button
					class="ssentio-mfa__resend"
					type="button"
					onclick={() => onResend?.()}
					disabled={isDisabled}
				>
					Resend code
				</button>
			{/if}
		</div>
	</form>

	<p id={errorId} class="ssentio-mfa__error" role="alert" aria-live="assertive">
		{#if view.error}{view.error}{/if}
	</p>
</section>

<style>
	.ssentio-mfa {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-inline-size: 24rem;
	}

	.ssentio-mfa__heading {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
	}

	.ssentio-mfa__prompt {
		margin: 0;
		font-size: 0.875rem;
		opacity: 0.85;
	}

	.ssentio-mfa__form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.ssentio-mfa__label {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.ssentio-mfa__input {
		font-size: 1.25rem;
		letter-spacing: 0.25em;
		padding: 0.5rem 0.75rem;
		min-block-size: var(--ui-min-target-size, 44px);
	}

	.ssentio-mfa__input:focus-visible {
		outline: 2px solid var(--ui-ring, currentColor);
		outline-offset: 2px;
	}

	.ssentio-mfa__actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.ssentio-mfa__submit,
	.ssentio-mfa__resend {
		min-block-size: var(--ui-min-target-size, 44px);
		padding-inline: 1rem;
	}

	.ssentio-mfa__error {
		margin: 0;
		min-block-size: 1.25rem;
		font-size: 0.875rem;
		color: var(--ui-danger, #b00020);
	}
</style>
