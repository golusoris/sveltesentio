// Component-render tests for ThemeToggle.svelte: the tri-state cycle button, its
// accessible name + data-mode, the onchange callback, and axe-clean (ADR-0046).
// The pure cycle/cookie logic is unit-tested in theme-mode.test.ts; here we
// assert the DOM + a11y contract and that the button drives the cycle.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ThemeToggle from '../src/theme/ThemeToggle.svelte';
import { expectNoAxeViolations } from './axe-helper.js';

describe('<ThemeToggle>', () => {
	it('renders a button with an accessible name reflecting the mode', () => {
		render(ThemeToggle, { mode: 'system' });
		expect(
			screen.getByRole('button', { name: 'Theme: System. Activate to switch.' }),
		).toBeInTheDocument();
	});

	it('exposes the current mode via data-mode', () => {
		render(ThemeToggle, { mode: 'dark' });
		expect(screen.getByRole('button')).toHaveAttribute('data-mode', 'dark');
	});

	it('cycles light → dark → system and fires onchange each step', async () => {
		const onchange = vi.fn();
		render(ThemeToggle, { mode: 'light', onchange });
		const btn = screen.getByRole('button');

		await fireEvent.click(btn);
		expect(onchange).toHaveBeenNthCalledWith(1, 'dark');
		expect(btn).toHaveAttribute('data-mode', 'dark');

		await fireEvent.click(btn);
		expect(onchange).toHaveBeenNthCalledWith(2, 'system');

		await fireEvent.click(btn);
		expect(onchange).toHaveBeenNthCalledWith(3, 'light');
	});

	it('shows the text label when showLabel is set', () => {
		render(ThemeToggle, { mode: 'light', showLabel: true });
		expect(screen.getByRole('button')).toHaveTextContent('Light');
	});

	it('is axe-clean (icon-only)', async () => {
		const { container } = render(ThemeToggle, { mode: 'system' });
		await expectNoAxeViolations(container);
	});

	it('is axe-clean with a visible label', async () => {
		const { container } = render(ThemeToggle, { mode: 'dark', showLabel: true });
		await expectNoAxeViolations(container);
	});
});
