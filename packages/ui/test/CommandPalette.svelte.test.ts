// Component-render tests for CommandPalette.svelte: the WAI-ARIA combobox +
// listbox-in-dialog pattern, keyboard navigation, and type-to-filter (ADR-0025).
// The component is a thin view over the pure `CommandRegistry`; here we mount it
// open with a real registry and drive it through the DOM.
import { fireEvent, render, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CommandPalette from '../src/cmd/CommandPalette.svelte';
import { CommandRegistry, type Command } from '../src/cmd/registry.js';
import { expectNoAxeViolations } from './axe-helper.js';

function makeRegistry(extra: Partial<Record<string, () => void>> = {}): {
	registry: CommandRegistry;
	runs: Record<string, ReturnType<typeof vi.fn>>;
} {
	const runs = {
		open: vi.fn(),
		save: vi.fn(),
		settings: vi.fn(),
	};
	const commands: Command[] = [
		{ id: 'open', title: 'Open File', shortcut: '$mod+O', run: extra.open ?? runs.open },
		{ id: 'save', title: 'Save File', shortcut: '$mod+S', run: extra.save ?? runs.save },
		{
			id: 'settings',
			title: 'Settings',
			subtitle: 'Preferences',
			run: extra.settings ?? runs.settings,
		},
	];
	return { registry: new CommandRegistry().register(...commands), runs };
}

function renderOpen() {
	const { registry, runs } = makeRegistry();
	const result = render(CommandPalette, { registry, open: true });
	return { ...result, runs };
}

describe('<CommandPalette>', () => {
	it('renders a modal dialog labelled "Command palette"', () => {
		const { getByRole } = renderOpen();

		const dialog = getByRole('dialog', { name: 'Command palette' });
		expect(dialog).toBeInTheDocument();
		expect(dialog).toHaveAttribute('aria-modal', 'true');
	});

	it('renders nothing when closed', () => {
		const { registry } = makeRegistry();
		const { queryByRole } = render(CommandPalette, { registry, open: false });
		expect(queryByRole('dialog')).toBeNull();
		expect(queryByRole('combobox')).toBeNull();
	});

	it('wires the combobox input to the listbox (aria-controls + aria-expanded)', () => {
		const { getByRole } = renderOpen();

		const input = getByRole('combobox');
		const list = getByRole('listbox', { name: 'Commands' });
		expect(input).toHaveAttribute('aria-expanded', 'true');
		expect(input).toHaveAttribute('aria-controls', list.id);
	});

	it('lists every command as an option and highlights the first via aria-activedescendant', () => {
		const { getByRole, getAllByRole } = renderOpen();

		const options = getAllByRole('option');
		expect(options.map((o) => o.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Open File $mod+O',
			'Save File $mod+S',
			'Settings — Preferences',
		]);

		const input = getByRole('combobox');
		// The first option is active and the input points at it.
		expect(options[0]).toHaveAttribute('aria-selected', 'true');
		expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
	});

	it('moves the active option down on ArrowDown (aria-activedescendant follows)', async () => {
		const { getByRole, getAllByRole } = renderOpen();
		const input = getByRole('combobox');

		await fireEvent.keyDown(input, { key: 'ArrowDown' });

		const options = getAllByRole('option');
		expect(options[0]).toHaveAttribute('aria-selected', 'false');
		expect(options[1]).toHaveAttribute('aria-selected', 'true');
		expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
	});

	it('does not move past the last option on repeated ArrowDown', async () => {
		const { getByRole, getAllByRole } = renderOpen();
		const input = getByRole('combobox');

		for (let i = 0; i < 5; i++) await fireEvent.keyDown(input, { key: 'ArrowDown' });

		const options = getAllByRole('option');
		const last = options[options.length - 1];
		expect(last).toHaveAttribute('aria-selected', 'true');
		expect(input).toHaveAttribute('aria-activedescendant', last.id);
	});

	it('runs the active command on Enter and closes the palette', async () => {
		const { getByRole, queryByRole, runs } = renderOpen();
		const input = getByRole('combobox');

		// Move to the second option (Save File) then activate it.
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(runs.save).toHaveBeenCalledTimes(1);
		expect(runs.open).not.toHaveBeenCalled();
		// open is bindable and set to false by runAt -> the dialog unmounts.
		expect(queryByRole('dialog')).toBeNull();
	});

	it('runs a command on option click', async () => {
		const { getAllByRole, runs } = renderOpen();
		const settings = getAllByRole('option')[2];

		await fireEvent.click(settings);
		expect(runs.settings).toHaveBeenCalledTimes(1);
	});

	it('filters options as the user types (type-to-filter)', async () => {
		const { getByRole, getAllByRole } = renderOpen();
		const input = getByRole('combobox');

		await fireEvent.input(input, { target: { value: 'save' } });

		const options = getAllByRole('option');
		expect(options).toHaveLength(1);
		expect(options[0]).toHaveTextContent('Save File');
	});

	it('matches on the subtitle when filtering', async () => {
		const { getByRole, getAllByRole } = renderOpen();
		const input = getByRole('combobox');

		await fireEvent.input(input, { target: { value: 'preferences' } });

		const options = getAllByRole('option');
		expect(options).toHaveLength(1);
		expect(options[0]).toHaveTextContent('Settings');
	});

	it('shows an empty-state option and drops aria-activedescendant when nothing matches', async () => {
		const { getByRole, getAllByRole } = renderOpen();
		const input = getByRole('combobox');

		await fireEvent.input(input, { target: { value: 'zzzz-no-match' } });

		const options = getAllByRole('option');
		expect(options).toHaveLength(1);
		expect(options[0]).toHaveTextContent('No commands found.');
		expect(options[0]).toHaveAttribute('aria-disabled', 'true');
		expect(input).not.toHaveAttribute('aria-activedescendant');
	});

	it('resets the active index to the first result after the query changes', async () => {
		const { getByRole, getAllByRole } = renderOpen();
		const input = getByRole('combobox');

		// Move down, then type — active index should snap back to 0.
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await fireEvent.input(input, { target: { value: 'file' } });

		const options = getAllByRole('option');
		expect(options[0]).toHaveAttribute('aria-selected', 'true');
		expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
	});

	it('closes on the dismiss overlay button', async () => {
		const { getByRole, queryByRole } = renderOpen();

		await fireEvent.click(getByRole('button', { name: 'Close command palette' }));
		expect(queryByRole('dialog')).toBeNull();
	});

	it('is axe-clean while open', async () => {
		const { container } = renderOpen();
		const dialog = within(container).getByRole('dialog');
		await expectNoAxeViolations(dialog);
	});
});
