import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MfaEnroll from '../src/MfaEnroll.svelte';
import { expectNoAxeViolations } from './axe-helper.js';

const SECRET = 'JBSWY3DPEHPK3PXP';
const OTPAUTH = 'otpauth://totp/Sveltesentio:alice?secret=JBSWY3DPEHPK3PXP&issuer=Sveltesentio';
// 1×1 transparent PNG so the <img> has a valid src without a network/canvas dep.
const QR =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('<MfaEnroll>', () => {
	it('renders the enrolment heading region and the readonly secret', () => {
		render(MfaEnroll, { secret: SECRET, onVerify: vi.fn() });

		expect(
			screen.getByRole('region', { name: 'Set up two-factor authentication' }),
		).toBeInTheDocument();

		const secret = screen.getByLabelText(/secret key/i);
		expect(secret).toHaveValue(SECRET);
		expect(secret).toHaveAttribute('readonly');
	});

	it('renders the labelled verification input with OTP-friendly attributes', () => {
		render(MfaEnroll, { secret: SECRET, onVerify: vi.fn() });

		const input = screen.getByRole('textbox', { name: 'Verification code' });
		expect(input).toHaveAttribute('inputmode', 'numeric');
		expect(input).toHaveAttribute('autocomplete', 'one-time-code');
		expect(input).toHaveAttribute('aria-invalid', 'false');
		expect(input).toHaveAttribute('aria-describedby', 'mfa-enroll-steps');
	});

	it('shows the QR image with descriptive alt text when a qr source is provided', () => {
		render(MfaEnroll, {
			secret: SECRET,
			qr: QR,
			accountLabel: 'alice@example.com',
			onVerify: vi.fn(),
		});

		const img = screen.getByRole('img', {
			name: /add alice@example\.com to an authenticator app/i,
		});
		expect(img).toHaveAttribute('src', QR);
	});

	it('omits the QR image and provisioning URI when those props are absent', () => {
		render(MfaEnroll, { secret: SECRET, onVerify: vi.fn() });

		expect(screen.queryByRole('img')).toBeNull();
		expect(screen.queryByLabelText(/provisioning uri/i)).toBeNull();
	});

	it('renders the readonly provisioning URI when otpauthUri is provided', () => {
		render(MfaEnroll, { secret: SECRET, otpauthUri: OTPAUTH, onVerify: vi.fn() });

		const uri = screen.getByLabelText(/provisioning uri/i);
		expect(uri).toHaveValue(OTPAUTH);
		expect(uri).toHaveAttribute('readonly');
	});

	it('keeps verify disabled until a submittable code is entered, then calls onVerify with the trimmed value', async () => {
		const onVerify = vi.fn();
		render(MfaEnroll, { secret: SECRET, onVerify });

		const submit = screen.getByRole('button', { name: 'Verify and enable' });
		expect(submit).toBeDisabled();

		const input = screen.getByRole('textbox', { name: 'Verification code' });
		await fireEvent.input(input, { target: { value: ' 246802 ' } });
		expect(submit).toBeEnabled();

		// jsdom does not implicitly submit a form on button click; dispatch the
		// submit the browser would raise, which the component handles via onsubmit.
		await fireEvent.submit(input.closest('form') as HTMLFormElement);
		expect(onVerify).toHaveBeenCalledTimes(1);
		expect(onVerify).toHaveBeenCalledWith('246802');
	});

	it('does not call onVerify when submitting a too-short code', async () => {
		const onVerify = vi.fn();
		render(MfaEnroll, { secret: SECRET, onVerify });

		const input = screen.getByRole('textbox', { name: 'Verification code' });
		await fireEvent.input(input, { target: { value: '99' } });
		await fireEvent.submit(input.closest('form') as HTMLFormElement);

		expect(onVerify).not.toHaveBeenCalled();
	});

	it('announces a verification error and wires the input to the error region', () => {
		render(MfaEnroll, {
			secret: SECRET,
			onVerify: vi.fn(),
			error: 'That code did not match. Try again.',
		});

		const alert = screen.getByRole('alert');
		expect(alert).toHaveTextContent('That code did not match. Try again.');

		const input = screen.getByRole('textbox', { name: 'Verification code' });
		expect(input).toHaveAttribute('aria-invalid', 'true');
		expect(input).toHaveAttribute('aria-describedby', 'mfa-enroll-steps mfa-enroll-error');
	});

	it('disables the verify input + button while a submission is pending', () => {
		render(MfaEnroll, { secret: SECRET, onVerify: vi.fn(), pending: true });

		expect(screen.getByRole('textbox', { name: 'Verification code' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Verifying…' })).toBeDisabled();
	});

	it('is axe-clean with secret, URI, and QR present', async () => {
		const { container } = render(MfaEnroll, {
			secret: SECRET,
			otpauthUri: OTPAUTH,
			qr: QR,
			accountLabel: 'alice@example.com',
			onVerify: vi.fn(),
		});
		await expectNoAxeViolations(container);
	});

	it('is axe-clean in the verification-error state', async () => {
		const { container } = render(MfaEnroll, {
			secret: SECRET,
			onVerify: vi.fn(),
			error: 'That code did not match. Try again.',
		});
		await expectNoAxeViolations(container);
	});
});
