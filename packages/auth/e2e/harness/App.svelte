<!--
@component
E2E harness page (NOT shipped — excluded from the package `files`). Mounts the
real `MfaChallenge` / `MfaEnroll` Svelte 5 components and the real
`registerPasskey` ceremony so a headless Chromium driven by Playwright exercises
them end-to-end, including the CDP WebAuthn virtual authenticator.

The components are callback-driven (they own no network), so this harness plays
the "caller": it owns a tiny in-page verifier that accepts a single correct code
and otherwise returns the typed `mfa-invalid` state via the genuine
`handleAuthError(new ProblemError(...))` path — the same narrowing the framework
ships. Results are surfaced as DOM text + `data-*` attributes for Playwright to
assert against; nothing here mocks the components or the passkey wrappers.
-->
<script lang="ts">
	import { ProblemError } from '@sveltesentio/core';
	import MfaChallenge from '../../src/MfaChallenge.svelte';
	import MfaEnroll from '../../src/MfaEnroll.svelte';
	import { registerPasskey } from '../../src/passkey.js';
	import { handleAuthError, MFA_INVALID, MFA_REQUIRED } from '../../src/mfa.js';
	import type { AuthErrorState } from '../../src/mfa.js';
	import type { PublicKeyCredentialCreationOptionsJSON } from '../../src/passkey.js';

	// --- MFA challenge: the harness plays the server. The single correct code ---
	const CORRECT_CODE = '123456';

	let challengeState = $state<AuthErrorState>(
		handleAuthError(new ProblemError({ type: MFA_REQUIRED, status: 401 })),
	);
	let pending = $state(false);
	let verifiedCode = $state<string | null>(null);

	async function onChallengeSubmit(code: string): Promise<void> {
		pending = true;
		// Simulate a round-trip so the "Verifying…" state is observable.
		await Promise.resolve();
		if (code === CORRECT_CODE) {
			verifiedCode = code;
			// Reset to a fresh challenge view; success is reported via data-attr below.
			challengeState = handleAuthError(new ProblemError({ type: MFA_REQUIRED, status: 401 }));
		} else {
			verifiedCode = null;
			challengeState = handleAuthError(new ProblemError({ type: MFA_INVALID, status: 401 }));
		}
		pending = false;
	}

	// --- MFA enrolment ---
	const ENROLL_SECRET = 'JBSWY3DPEHPK3PXP';
	let enrollError = $state<string | undefined>(undefined);
	let enrolledCode = $state<string | null>(null);

	function onEnrollVerify(code: string): void {
		if (code === CORRECT_CODE) {
			enrolledCode = code;
			enrollError = undefined;
		} else {
			enrolledCode = null;
			enrollError = 'That code did not match. Try again.';
		}
	}

	// --- Passkey enrolment: drives the REAL WebAuthn ceremony. With a CDP virtual ---
	// authenticator attached, `navigator.credentials.create` resolves and
	// `registerPasskey` returns the attestation JSON we surface for assertion.
	let passkeyStatus = $state<'idle' | 'pending' | 'ok' | 'error'>('idle');
	let passkeyCredentialId = $state<string | null>(null);
	let passkeyError = $state<string | null>(null);

	function makeCreationOptions(): PublicKeyCredentialCreationOptionsJSON {
		// `rp.id` defaults to the page origin (`localhost`, a valid WebAuthn RP id).
		// A `?rp=` query override lets the negative e2e force a registrable-suffix
		// mismatch so `navigator.credentials.create` rejects immediately and the
		// wrapper's error path is exercised deterministically (no ceremony-timeout wait).
		const rpId = new URLSearchParams(window.location.search).get('rp') ?? 'localhost';
		// `challenge` / `user.id` are base64url per the JSON ceremony contract.
		return {
			challenge: 'ZHVtbXktY2hhbGxlbmdl',
			rp: { name: 'Sveltesentio E2E', id: rpId },
			user: { id: 'dXNlci0xMjM', name: 'alice@example.com', displayName: 'Alice' },
			pubKeyCredParams: [
				{ type: 'public-key', alg: -7 },
				{ type: 'public-key', alg: -257 },
			],
			timeout: 60000,
			attestation: 'none',
			authenticatorSelection: {
				residentKey: 'preferred',
				userVerification: 'preferred',
			},
		};
	}

	async function onEnrollPasskey(): Promise<void> {
		passkeyStatus = 'pending';
		passkeyError = null;
		passkeyCredentialId = null;
		try {
			const result = await registerPasskey(makeCreationOptions());
			passkeyCredentialId = result.id;
			passkeyStatus = 'ok';
		} catch (cause) {
			passkeyError = cause instanceof Error ? cause.message : String(cause);
			passkeyStatus = 'error';
		}
	}
</script>

<main>
	<section data-testid="challenge">
		<MfaChallenge errorState={challengeState} onSubmit={onChallengeSubmit} {pending} />
		<p data-testid="challenge-result" data-verified={verifiedCode ?? ''}>
			{#if verifiedCode}Verified: {verifiedCode}{/if}
		</p>
	</section>

	<section data-testid="enroll">
		<MfaEnroll secret={ENROLL_SECRET} onVerify={onEnrollVerify} error={enrollError} />
		<p data-testid="enroll-result" data-enrolled={enrolledCode ?? ''}>
			{#if enrolledCode}Enrolled: {enrolledCode}{/if}
		</p>
	</section>

	<section data-testid="passkey">
		<h2>Passkey</h2>
		<button type="button" data-testid="passkey-register" onclick={onEnrollPasskey}>
			Register passkey
		</button>
		<p
			data-testid="passkey-status"
			data-status={passkeyStatus}
			data-credential-id={passkeyCredentialId ?? ''}
		>
			{#if passkeyStatus === 'ok'}Registered passkey: {passkeyCredentialId}{/if}
			{#if passkeyStatus === 'error'}Passkey error: {passkeyError}{/if}
		</p>
	</section>
</main>
