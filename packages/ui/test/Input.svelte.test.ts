// Component-render tests for Input.svelte: native <input>, value binding, the
// invalid → aria-invalid + destructive-class contract, rest-prop forwarding, and
// axe-clean (with an associated label via InputHarness). Class logic is unit-
// tested in input-variants.test.ts; here we assert the DOM + a11y contract.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Input from '../src/input/Input.svelte';
import InputHarness from './InputHarness.svelte';
import { expectNoAxeViolations } from './axe-helper.js';

describe('<Input>', () => {
	it('renders a native text input by default', () => {
		render(Input, { 'aria-label': 'Name' });
		const input = screen.getByRole('textbox', { name: 'Name' });
		expect(input.tagName).toBe('INPUT');
		expect(input).toHaveAttribute('type', 'text');
	});

	it('applies the base classes', () => {
		render(Input, { 'aria-label': 'Name' });
		expect(screen.getByRole('textbox', { name: 'Name' }).className).toContain('border-input');
	});

	it('reflects typed input via two-way binding', async () => {
		render(InputHarness, { value: '' });
		const input = screen.getByLabelText('Email');
		await fireEvent.input(input, { target: { value: 'a@b.com' } });
		expect(input).toHaveValue('a@b.com');
	});

	it('sets aria-invalid + destructive classes when invalid', () => {
		render(Input, { 'aria-label': 'Name', invalid: true });
		const input = screen.getByRole('textbox', { name: 'Name' });
		expect(input).toHaveAttribute('aria-invalid', 'true');
		expect(input.className).toContain('border-destructive');
	});

	it('omits aria-invalid when valid', () => {
		render(Input, { 'aria-label': 'Name', invalid: false });
		expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('aria-invalid');
	});

	it('forwards arbitrary attributes (placeholder, disabled)', () => {
		render(Input, { 'aria-label': 'Name', placeholder: 'you@example.com', disabled: true });
		const input = screen.getByRole('textbox', { name: 'Name' });
		expect(input).toHaveAttribute('placeholder', 'you@example.com');
		expect(input).toBeDisabled();
	});

	it('is axe-clean with an associated label', async () => {
		const { container } = render(InputHarness, { value: '' });
		await expectNoAxeViolations(container);
	});

	it('is axe-clean in the invalid state', async () => {
		const { container } = render(InputHarness, { value: 'bad', invalid: true });
		await expectNoAxeViolations(container);
	});
});
