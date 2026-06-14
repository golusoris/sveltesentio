<!--
@component
MfaEnroll — accessible TOTP enrolment UI (ADR-0036). Renders the shared secret
for manual entry (and an optional QR image for scanning) plus a verify form that
confirms the user's authenticator is in sync.

Callback-driven — the component owns no network. The caller generates the
`otpauth://` URI / secret server-side, passes them in, and handles the
`onVerify(code)` submission. The optional `error` prop surfaces a verification
failure via an `aria-live="assertive"` region.

WCAG 2.2 AA:
- The secret is exposed as readonly, labelled, selectable text (not an image-only secret).
- The QR image, when provided, carries descriptive `alt` text.
- The verify input is labelled, `inputmode="numeric"`, `autocomplete="one-time-code"`.
- The error region is `aria-live="assertive"` and wired via `aria-describedby`.

Plain `tsc` does not type-check `.svelte`; the typed helpers live in `./mfa-view`.
-->
<script lang="ts">
	import { isSubmittableCode, type MfaCodeSubmit } from './mfa-view.js';

	interface Props {
		/** The shared secret (base32), rendered for manual authenticator entry. */
		secret: string;
		/** The full `otpauth://` provisioning URI (optional; shown for advanced users). */
		otpauthUri?: string | undefined;
		/** A QR image source (data URL or URL) encoding the provisioning URI. */
		qr?: string | undefined;
		/** Accessible label for the account being enrolled (used in the QR alt text). */
		accountLabel?: string;
		/** Called with the entered code to confirm enrolment. Caller owns the request. */
		onVerify: MfaCodeSubmit;
		/** Verification error message to announce, when the last attempt failed. */
		error?: string | undefined;
		/** Whether verification is in flight; disables input + buttons. */
		pending?: boolean;
		/** Stable id prefix for aria wiring. */
		idBase?: string;
	}

	const {
		secret,
		otpauthUri,
		qr,
		accountLabel = 'your account',
		onVerify,
		error,
		pending = false,
		idBase = 'mfa-enroll',
	}: Props = $props();

	let code = $state('');

	const headingId = $derived(`${idBase}-heading`);
	const secretId = $derived(`${idBase}-secret`);
	const uriId = $derived(`${idBase}-uri`);
	const inputId = $derived(`${idBase}-code`);
	const errorId = $derived(`${idBase}-error`);
	const stepsId = $derived(`${idBase}-steps`);

	const hasError = $derived(typeof error === 'string' && error.length > 0);
	const canSubmit = $derived(!pending && isSubmittableCode(code));
	const describedBy = $derived(hasError ? `${stepsId} ${errorId}` : stepsId);

	function handleSubmit(event: SubmitEvent): void {
		event.preventDefault();
		if (!canSubmit) return;
		onVerify(code.trim());
	}
</script>

<section class="ssentio-mfa-enroll" aria-labelledby={headingId}>
	<h2 id={headingId} class="ssentio-mfa-enroll__heading">Set up two-factor authentication</h2>

	{#if qr}
		<img
			class="ssentio-mfa-enroll__qr"
			src={qr}
			alt={`QR code to add ${accountLabel} to an authenticator app`}
			width="180"
			height="180"
		/>
	{/if}

	<div class="ssentio-mfa-enroll__secret">
		<label class="ssentio-mfa-enroll__label" for={secretId}>
			Secret key (enter manually if you cannot scan)
		</label>
		<input id={secretId} class="ssentio-mfa-enroll__secret-input" type="text" value={secret} readonly />
	</div>

	{#if otpauthUri}
		<div class="ssentio-mfa-enroll__secret">
			<label class="ssentio-mfa-enroll__label" for={uriId}>Provisioning URI</label>
			<input id={uriId} class="ssentio-mfa-enroll__secret-input" type="text" value={otpauthUri} readonly />
		</div>
	{/if}

	<form class="ssentio-mfa-enroll__form" onsubmit={handleSubmit}>
		<p id={stepsId} class="ssentio-mfa-enroll__steps">
			Enter the 6-digit code from your authenticator app to confirm.
		</p>
		<label class="ssentio-mfa-enroll__label" for={inputId}>Verification code</label>
		<input
			bind:value={code}
			id={inputId}
			class="ssentio-mfa-enroll__input"
			type="text"
			inputmode="numeric"
			autocomplete="one-time-code"
			pattern="[0-9]*"
			spellcheck="false"
			autocapitalize="off"
			aria-describedby={describedBy}
			aria-invalid={hasError}
			disabled={pending}
		/>
		<button class="ssentio-mfa-enroll__submit" type="submit" disabled={!canSubmit}>
			{pending ? 'Verifying…' : 'Verify and enable'}
		</button>
	</form>

	<p id={errorId} class="ssentio-mfa-enroll__error" role="alert" aria-live="assertive">
		{#if hasError}{error}{/if}
	</p>
</section>

<style>
	.ssentio-mfa-enroll {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-inline-size: 24rem;
	}

	.ssentio-mfa-enroll__heading {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
	}

	.ssentio-mfa-enroll__qr {
		align-self: center;
		image-rendering: pixelated;
	}

	.ssentio-mfa-enroll__secret,
	.ssentio-mfa-enroll__form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.ssentio-mfa-enroll__label {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.ssentio-mfa-enroll__secret-input {
		font-family: ui-monospace, monospace;
		font-size: 1rem;
		letter-spacing: 0.1em;
		padding: 0.5rem 0.75rem;
		min-block-size: var(--ui-min-target-size, 44px);
	}

	.ssentio-mfa-enroll__steps {
		margin: 0;
		font-size: 0.875rem;
		opacity: 0.85;
	}

	.ssentio-mfa-enroll__input {
		font-size: 1.25rem;
		letter-spacing: 0.25em;
		padding: 0.5rem 0.75rem;
		min-block-size: var(--ui-min-target-size, 44px);
	}

	.ssentio-mfa-enroll__input:focus-visible,
	.ssentio-mfa-enroll__secret-input:focus-visible {
		outline: 2px solid var(--ui-ring, currentColor);
		outline-offset: 2px;
	}

	.ssentio-mfa-enroll__submit {
		min-block-size: var(--ui-min-target-size, 44px);
		padding-inline: 1rem;
	}

	.ssentio-mfa-enroll__error {
		margin: 0;
		min-block-size: 1.25rem;
		font-size: 0.875rem;
		color: var(--ui-danger, #b00020);
	}
</style>
