// Component-render tests for Button.svelte: it renders a native <button>, applies
// the resolved variant/size classes, forwards rest props (type, disabled,
// aria-label), and is axe-clean (ADR-0014). The class logic itself is unit-tested
// in button-variants.test.ts; here we assert the DOM contract + a11y.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import Button from '../src/button/Button.svelte';
import { expectNoAxeViolations } from './axe-helper.js';

/** A text snippet usable as the Button's `children`. */
function text(label: string) {
	return createRawSnippet(() => ({ render: () => `<span>${label}</span>` }));
}

describe('<Button>', () => {
	it('renders a native button of type=button by default', () => {
		render(Button, { children: text('Save') });
		const btn = screen.getByRole('button', { name: 'Save' });
		expect(btn.tagName).toBe('BUTTON');
		expect(btn).toHaveAttribute('type', 'button');
	});

	it('applies variant + size classes', () => {
		render(Button, { variant: 'destructive', size: 'lg', children: text('Delete') });
		const btn = screen.getByRole('button', { name: 'Delete' });
		expect(btn.className).toContain('bg-destructive');
		expect(btn.className).toContain('h-10');
	});

	it('forwards onclick to the native button', async () => {
		const onclick = vi.fn();
		render(Button, { onclick, children: text('Go') });
		await fireEvent.click(screen.getByRole('button', { name: 'Go' }));
		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it('forwards the disabled attribute', () => {
		render(Button, { disabled: true, children: text('Go') });
		expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
	});

	it('honours an explicit type=submit', () => {
		render(Button, { type: 'submit', children: text('Submit') });
		expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('type', 'submit');
	});

	it('supports an accessible name for an icon-only button via aria-label', () => {
		render(Button, { size: 'icon', 'aria-label': 'Close' });
		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
	});

	it('is axe-clean with a text label', async () => {
		const { container } = render(Button, { children: text('Save') });
		await expectNoAxeViolations(container);
	});

	it('is axe-clean as an icon-only button with aria-label', async () => {
		const { container } = render(Button, { size: 'icon', 'aria-label': 'Close' });
		await expectNoAxeViolations(container);
	});
});
