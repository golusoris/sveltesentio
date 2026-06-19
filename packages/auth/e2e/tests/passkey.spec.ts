import { expect, test } from '@playwright/test';

/**
 * Passkey enrolment against the real `registerPasskey` wrapper, which calls
 * `@simplewebauthn/browser` → `navigator.credentials.create`. A CDP WebAuthn
 * virtual authenticator (`WebAuthn.addVirtualAuthenticator`) stands in for a
 * physical key so the ceremony resolves headlessly (auth/AGENTS.md).
 */
test.describe('passkey enrolment (WebAuthn virtual authenticator)', () => {
	test('registers a credential via the virtual authenticator', async ({ page }) => {
		// Attach a virtual authenticator over CDP BEFORE the ceremony starts.
		const client = await page.context().newCDPSession(page);
		await client.send('WebAuthn.enable', { enableUI: false });
		const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
			options: {
				protocol: 'ctap2',
				transport: 'internal',
				hasResidentKey: true,
				hasUserVerification: true,
				isUserVerified: true,
				automaticPresenceSimulation: true,
			},
		});
		expect(authenticatorId).toBeTruthy();

		await page.goto('/');

		const passkey = page.getByTestId('passkey');
		const status = page.getByTestId('passkey-status');

		await expect(status).toHaveAttribute('data-status', 'idle');

		await passkey.getByRole('button', { name: 'Register passkey' }).click();

		// The real ceremony completes: registerPasskey resolves with attestation JSON.
		await expect(status).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });

		const credentialId = await status.getAttribute('data-credential-id');
		expect(credentialId).toBeTruthy();
		expect((credentialId ?? '').length).toBeGreaterThan(0);

		// The authenticator now holds exactly one resident credential from this ceremony.
		const { credentials } = await client.send('WebAuthn.getCredentials', { authenticatorId });
		expect(credentials.length).toBe(1);

		await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
	});

	test('surfaces a ceremony failure through the wrapper error path', async ({ page }) => {
		// A virtual authenticator IS present, but the harness is asked (via `?rp=`)
		// to use an RP id that is not a registrable suffix of the page origin. The
		// browser rejects `navigator.credentials.create` immediately with a
		// SecurityError, and the real wrapper surfaces it — no ceremony-timeout wait.
		const client = await page.context().newCDPSession(page);
		await client.send('WebAuthn.enable', { enableUI: false });
		await client.send('WebAuthn.addVirtualAuthenticator', {
			options: {
				protocol: 'ctap2',
				transport: 'internal',
				hasResidentKey: true,
				hasUserVerification: true,
				isUserVerified: true,
				automaticPresenceSimulation: true,
			},
		});

		await page.goto('/?rp=not-a-suffix.example');

		const status = page.getByTestId('passkey-status');
		await page.getByTestId('passkey').getByRole('button', { name: 'Register passkey' }).click();

		await expect(status).toHaveAttribute('data-status', 'error', { timeout: 15_000 });
		await expect(status.getByText(/Passkey error/)).toBeVisible();
		// No credential was recorded on the failure path.
		await expect(status).toHaveAttribute('data-credential-id', '');
	});
});
