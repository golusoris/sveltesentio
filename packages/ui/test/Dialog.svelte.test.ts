// Component-render tests for Dialog.svelte: the WAI-ARIA dialog pattern (role,
// aria-modal, aria-labelledby/describedby), Escape + overlay dismissal, focus
// moving into the panel on open + returning on close, and axe-clean. The focus-
// trap math is unit-tested in dialog-logic.svelte.test.ts; here we drive the DOM.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Dialog from '../src/dialog/Dialog.svelte';
import DialogHarness from './DialogHarness.svelte';
import { expectNoAxeViolations } from './axe-helper.js';

describe('<Dialog>', () => {
	it('renders nothing when closed', () => {
		render(Dialog, { open: false, title: 'Hi' });
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('renders a modal dialog labelled + described by its title/description', () => {
		render(Dialog, { open: true, title: 'Delete item', description: 'Cannot be undone.' });
		const dialog = screen.getByRole('dialog', { name: 'Delete item' });
		expect(dialog).toHaveAttribute('aria-modal', 'true');
		const descId = dialog.getAttribute('aria-describedby');
		expect(descId).toBeTruthy();
		expect(document.getElementById(descId ?? '')).toHaveTextContent('Cannot be undone.');
	});

	it('omits aria-describedby when there is no description', () => {
		render(Dialog, { open: true, title: 'Plain' });
		expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
	});

	it('closes on Escape', async () => {
		render(DialogHarness, { open: true });
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('closes on overlay click', async () => {
		render(DialogHarness, { open: true });
		await fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('does not dismiss on Escape when dismissible=false', async () => {
		render(DialogHarness, { open: true, dismissible: false });
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
		expect(screen.getByRole('dialog')).toBeInTheDocument();
	});

	it('moves focus into the panel on open (first focusable)', async () => {
		render(DialogHarness, { open: true });
		await waitFor(() => {
			expect(screen.getByTestId('cancel')).toHaveFocus();
		});
	});

	it('returns focus to the opener after closing', async () => {
		render(DialogHarness, { open: false });
		const opener = screen.getByTestId('opener');
		opener.focus();
		await fireEvent.click(opener);
		await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(opener).toHaveFocus();
	});

	it('traps Tab from the last focusable back to the first', async () => {
		render(DialogHarness, { open: true });
		// Let the open-effect's initial focus settle so it doesn't clobber ours.
		await waitFor(() => expect(screen.getByTestId('cancel')).toHaveFocus());
		const confirm = screen.getByTestId('confirm');
		confirm.focus();
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
		expect(screen.getByTestId('cancel')).toHaveFocus();
	});

	it('traps Shift+Tab from the first focusable to the last', async () => {
		render(DialogHarness, { open: true });
		await waitFor(() => expect(screen.getByTestId('cancel')).toHaveFocus());
		const cancel = screen.getByTestId('cancel');
		cancel.focus();
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
		expect(screen.getByTestId('confirm')).toHaveFocus();
	});

	it('is axe-clean while open', async () => {
		const { container } = render(DialogHarness, { open: true });
		const dialog = within(container).getByRole('dialog');
		await expectNoAxeViolations(dialog);
	});
});
