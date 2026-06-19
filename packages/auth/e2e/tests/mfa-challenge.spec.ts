import { expect, test } from '@playwright/test';

/**
 * MFA challenge flow against the real `MfaChallenge` Svelte 5 component mounted
 * in the e2e harness. The harness plays the server: code `123456` verifies, any
 * other code yields the genuine typed `mfa-invalid` state via
 * `handleAuthError(new ProblemError(...))` — no substring matching, no mocks.
 */
test.describe('MfaChallenge', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
	});

	test('submit + verify happy path', async ({ page }) => {
		const challenge = page.getByTestId('challenge');
		const input = challenge.getByRole('textbox', { name: 'Two-factor authentication' });
		const submit = challenge.getByRole('button', { name: 'Verify' });

		// Submit is gated until a submittable code is present.
		await expect(submit).toBeDisabled();

		await input.fill('123456');
		await expect(submit).toBeEnabled();

		await submit.click();

		// The harness reports a successful verification via data-attr.
		const result = page.getByTestId('challenge-result');
		await expect(result).toHaveAttribute('data-verified', '123456');
		await expect(result).toHaveText('Verified: 123456');

		// No error was announced on the happy path.
		await expect(challenge.getByRole('alert')).toHaveText('');
		await expect(input).toHaveAttribute('aria-invalid', 'false');
	});

	test('invalid code announces the rejection and keeps the form retryable', async ({ page }) => {
		const challenge = page.getByTestId('challenge');
		const input = challenge.getByRole('textbox', { name: 'Two-factor authentication' });
		const submit = challenge.getByRole('button', { name: 'Verify' });

		await input.fill('000000');
		await submit.click();

		// The typed mfa-invalid state drives the assertive error region + aria-invalid.
		const alert = challenge.getByRole('alert');
		await expect(alert).toHaveText('That code was incorrect. Try again.');
		await expect(input).toHaveAttribute('aria-invalid', 'true');
		await expect(input).toHaveAttribute(
			'aria-describedby',
			'mfa-challenge-prompt mfa-challenge-error',
		);

		// The form stays enabled so the user can retry, and no success was recorded.
		await expect(input).toBeEnabled();
		await expect(page.getByTestId('challenge-result')).toHaveAttribute('data-verified', '');

		// Retrying with the correct code now verifies and clears the error.
		await input.fill('123456');
		await submit.click();
		await expect(page.getByTestId('challenge-result')).toHaveAttribute('data-verified', '123456');
		await expect(challenge.getByRole('alert')).toHaveText('');
	});
});
