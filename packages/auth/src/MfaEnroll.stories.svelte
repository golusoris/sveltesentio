<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import MfaEnroll from './MfaEnroll.svelte';

	// Callback-driven: the caller generates the secret/URI/QR server-side and
	// owns the verify request. Stories pass static demo values and a no-op
	// handler that surfaces in the Storybook actions panel.
	function logVerify(code: string): void {
		console.warn('[MfaEnroll] onVerify', code);
	}

	const SECRET = 'JBSWY3DPEHPK3PXP';
	const ACCOUNT = 'ada@example.com';
	const OTPAUTH = `otpauth://totp/Sveltesentio:${ACCOUNT}?secret=${SECRET}&issuer=Sveltesentio`;

	// A tiny inline SVG data URL stands in for a server-rendered QR image so the
	// QR branch renders without pulling in a QR-encoding dependency.
	const QR =
		'data:image/svg+xml;utf8,' +
		encodeURIComponent(
			`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="%23fff"/><path fill="%23000" d="M0 0h3v3H0zm5 0h3v3H5zM4 1h1v1H4zM0 5h3v3H0zM4 4h1v1H4zm2 0h2v1H6zM5 5h1v2H5zm2 1h1v2H7z"/></svg>`,
		);

	const { Story } = defineMeta({
		title: 'auth/MfaEnroll',
		component: MfaEnroll,
		tags: ['autodocs'],
		argTypes: {
			secret: { control: 'text' },
			accountLabel: { control: 'text' },
			error: { control: 'text' },
			pending: { control: 'boolean' },
			idBase: { control: 'text' },
		},
		args: {
			secret: SECRET,
			accountLabel: ACCOUNT,
			onVerify: logVerify,
			pending: false,
		},
	});
</script>

<!-- Secret-only enrolment: manual key entry, no QR. -->
<Story name="Default" args={{ secret: SECRET, accountLabel: ACCOUNT, onVerify: logVerify }} />

<!-- Full enrolment: QR image + provisioning URI for scan-or-paste. -->
<Story
	name="With QR"
	args={{ secret: SECRET, accountLabel: ACCOUNT, qr: QR, otpauthUri: OTPAUTH, onVerify: logVerify }}
/>

<!-- Verification failed: the `aria-live` error region announces the message. -->
<Story
	name="Verification error"
	args={{
		secret: SECRET,
		accountLabel: ACCOUNT,
		onVerify: logVerify,
		error: 'That code was incorrect. Try again.',
	}}
/>

<!-- Submission in flight: input + button disabled, button reads "Verifying…". -->
<Story
	name="Pending"
	args={{ secret: SECRET, accountLabel: ACCOUNT, onVerify: logVerify, pending: true }}
/>
