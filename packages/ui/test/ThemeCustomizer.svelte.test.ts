// Component-render tests for ThemeCustomizer.svelte: a labelled oklch field per
// token, the onchange(sanitised-override) contract, the invalid → aria-invalid
// affordance, reset, and axe-clean (ADR-0046). The validation/emission logic is
// unit-tested in theme-customizer.test.ts; here we assert the DOM + a11y wiring.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ThemeCustomizer from '../src/theme/ThemeCustomizer.svelte';
import { expectNoAxeViolations } from './axe-helper.js';

describe('<ThemeCustomizer>', () => {
	it('renders a labelled field for each customisable token', () => {
		render(ThemeCustomizer, { tokens: ['primary', 'accent'] });
		expect(screen.getByLabelText('primary')).toBeInTheDocument();
		expect(screen.getByLabelText('accent')).toBeInTheDocument();
	});

	it('fires onchange with a sanitised override on valid input', async () => {
		const onchange = vi.fn();
		render(ThemeCustomizer, { tokens: ['primary'], onchange });
		await fireEvent.input(screen.getByLabelText('primary'), {
			target: { value: 'oklch(0.6 0.1 120)' },
		});
		expect(onchange).toHaveBeenLastCalledWith({ primary: 'oklch(0.6 0.1 120)' });
	});

	it('drops an invalid value from the sanitised override + marks the field aria-invalid', async () => {
		const onchange = vi.fn();
		render(ThemeCustomizer, { tokens: ['primary'], onchange });
		const field = screen.getByLabelText('primary');
		await fireEvent.input(field, { target: { value: 'not-a-color' } });
		expect(field).toHaveAttribute('aria-invalid', 'true');
		expect(onchange).toHaveBeenLastCalledWith({});
	});

	it('clears a token when the field is emptied', async () => {
		const onchange = vi.fn();
		render(ThemeCustomizer, {
			tokens: ['primary'],
			override: { primary: 'oklch(0.6 0.1 120)' },
			onchange,
		});
		await fireEvent.input(screen.getByLabelText('primary'), { target: { value: '' } });
		expect(onchange).toHaveBeenLastCalledWith({});
	});

	it('resets all overrides via the reset button', async () => {
		const onchange = vi.fn();
		render(ThemeCustomizer, {
			tokens: ['primary'],
			override: { primary: 'oklch(0.6 0.1 120)' },
			onchange,
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
		expect(onchange).toHaveBeenLastCalledWith({});
	});

	it('is axe-clean', async () => {
		const { container } = render(ThemeCustomizer, { tokens: ['primary', 'accent', 'ring'] });
		await expectNoAxeViolations(container);
	});

	it('is axe-clean with an invalid field', async () => {
		const { container } = render(ThemeCustomizer, {
			tokens: ['primary'],
			override: { primary: 'bad' },
		});
		await expectNoAxeViolations(container);
	});
});
