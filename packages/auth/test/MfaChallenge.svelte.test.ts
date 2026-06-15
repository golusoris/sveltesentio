import { ProblemError } from '@sveltesentio/core';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MfaChallenge from '../src/MfaChallenge.svelte';
import { handleAuthError, MFA_INVALID, MFA_RATE_LIMITED, MFA_REQUIRED } from '../src/mfa.js';
import type { AuthErrorState } from '../src/mfa.js';
import { DEFAULT_MFA_CHALLENGE_COPY } from '../src/mfa-view.js';
import { expectNoAxeViolations } from './axe-helper.js';

const required = (): AuthErrorState =>
	handleAuthError(new ProblemError({ type: MFA_REQUIRED, status: 401 }));
const invalid = (): AuthErrorState =>
	handleAuthError(new ProblemError({ type: MFA_INVALID, status: 401 }));
const rateLimited = (retryAfter?: number): AuthErrorState =>
	handleAuthError(
		new ProblemError({
			type: MFA_RATE_LIMITED,
			status: 429,
			extensions: retryAfter === undefined ? {} : { retryAfter },
		}),
	);

afterEach(() => {
	vi.restoreAllMocks();
});

describe('<MfaChallenge>', () => {
	it('renders the labelled code input with OTP-friendly attributes', () => {
		render(MfaChallenge, { errorState: required(), onSubmit: vi.fn() });

		const input = screen.getByRole('textbox', { name: DEFAULT_MFA_CHALLENGE_COPY.heading });
		expect(input).toBeInTheDocument();
		expect(input).toHaveAttribute('inputmode', 'numeric');
		expect(input).toHaveAttribute('autocomplete', 'one-time-code');
		expect(input).toHaveAttribute('aria-invalid', 'false');
		// describedby points at the prompt only when there is no error.
		expect(input).toHaveAttribute('aria-describedby', 'mfa-challenge-prompt');
	});

	it('exposes a labelled region and the prompt copy', () => {
		render(MfaChallenge, { errorState: required(), onSubmit: vi.fn() });

		const region = screen.getByRole('region', {
			name: DEFAULT_MFA_CHALLENGE_COPY.heading,
		});
		expect(region).toBeInTheDocument();
		expect(within(region).getByText(DEFAULT_MFA_CHALLENGE_COPY.prompt)).toBeInTheDocument();
		// Fresh challenge: the assertive error region is present but empty.
		expect(screen.getByRole('alert')).toHaveTextContent('');
	});

	it('keeps submit disabled until a submittable code is entered, then calls onSubmit with the trimmed value', async () => {
		const onSubmit = vi.fn();
		render(MfaChallenge, { errorState: required(), onSubmit });

		const submit = screen.getByRole('button', { name: 'Verify' });
		expect(submit).toBeDisabled();

		const input = screen.getByRole('textbox', { name: DEFAULT_MFA_CHALLENGE_COPY.heading });
		await fireEvent.input(input, { target: { value: ' 123456 ' } });
		expect(submit).toBeEnabled();

		// jsdom does not implicitly submit a form on button click; dispatch the
		// submit the browser would raise, which the component handles via onsubmit.
		await fireEvent.submit(input.closest('form') as HTMLFormElement);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith('123456');
	});

	it('does not call onSubmit when the form submits with a too-short code', async () => {
		const onSubmit = vi.fn();
		render(MfaChallenge, { errorState: required(), onSubmit });

		const input = screen.getByRole('textbox', { name: DEFAULT_MFA_CHALLENGE_COPY.heading });
		await fireEvent.input(input, { target: { value: '12' } });
		await fireEvent.submit(input.closest('form') as HTMLFormElement);

		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('announces the rejection and wires the input to the error region on mfa-invalid', () => {
		render(MfaChallenge, { errorState: invalid(), onSubmit: vi.fn() });

		const alert = screen.getByRole('alert');
		expect(alert).toHaveTextContent(DEFAULT_MFA_CHALLENGE_COPY.invalid);

		const input = screen.getByRole('textbox', { name: DEFAULT_MFA_CHALLENGE_COPY.heading });
		expect(input).toHaveAttribute('aria-invalid', 'true');
		expect(input).toHaveAttribute('aria-describedby', 'mfa-challenge-prompt mfa-challenge-error');
		// The form stays enabled so the user can retry.
		expect(input).toBeEnabled();
	});

	it('disables the input + submit and shows the retry window on mfa-rate-limited', () => {
		render(MfaChallenge, { errorState: rateLimited(30), onSubmit: vi.fn() });

		const input = screen.getByRole('textbox', { name: DEFAULT_MFA_CHALLENGE_COPY.heading });
		expect(input).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();

		const alert = screen.getByRole('alert');
		expect(alert).toHaveTextContent(DEFAULT_MFA_CHALLENGE_COPY.rateLimited);
		expect(alert).toHaveTextContent('30');
	});

	it('disables the input while a submission is pending and labels the submit button', () => {
		render(MfaChallenge, { errorState: required(), onSubmit: vi.fn(), pending: true });

		expect(
			screen.getByRole('textbox', { name: DEFAULT_MFA_CHALLENGE_COPY.heading }),
		).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Verifying…' })).toBeDisabled();
	});

	it('renders a resend control only when onResend is supplied and invokes it on click', async () => {
		const onResend = vi.fn();
		const { rerender } = render(MfaChallenge, {
			errorState: required(),
			onSubmit: vi.fn(),
		});
		expect(screen.queryByRole('button', { name: 'Resend code' })).toBeNull();

		await rerender({ errorState: required(), onSubmit: vi.fn(), onResend });
		const resend = screen.getByRole('button', { name: 'Resend code' });
		await fireEvent.click(resend);
		expect(onResend).toHaveBeenCalledTimes(1);
	});

	it('is axe-clean in the fresh-challenge state', async () => {
		const { container } = render(MfaChallenge, {
			errorState: required(),
			onSubmit: vi.fn(),
			onResend: vi.fn(),
		});
		await expectNoAxeViolations(container);
	});

	it('is axe-clean in the error (rate-limited) state', async () => {
		const { container } = render(MfaChallenge, {
			errorState: rateLimited(30),
			onSubmit: vi.fn(),
		});
		await expectNoAxeViolations(container);
	});
});
