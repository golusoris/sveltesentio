import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import LocaleSwitcher from '../src/LocaleSwitcher.svelte';
import { expectNoAxeViolations } from './axe-helper.js';

interface LocaleOption {
	code: string;
	label: string;
}

const locales: readonly LocaleOption[] = [
	{ code: 'en-US', label: 'English' },
	{ code: 'de-AT', label: 'Deutsch' },
	{ code: 'ar', label: 'العربية' },
];

function renderSwitcher(
	props: {
		locales?: readonly LocaleOption[];
		current?: string;
		onChange?: (code: string) => void;
		label?: string;
		id?: string;
	} = {},
) {
	const onChange = props.onChange ?? vi.fn();
	const result = render(LocaleSwitcher, {
		locales: props.locales ?? locales,
		current: props.current ?? 'en-US',
		onChange,
		...(props.label === undefined ? {} : { label: props.label }),
		...(props.id === undefined ? {} : { id: props.id }),
	});
	return { ...result, onChange };
}

describe('<LocaleSwitcher>', () => {
	it('renders a labelled select (combobox) with the default accessible name', () => {
		renderSwitcher();
		const select = screen.getByRole('combobox', { name: 'Language' });
		expect(select).toBeInTheDocument();
	});

	it('honours a custom accessible label', () => {
		renderSwitcher({ label: 'Sprache' });
		expect(screen.getByRole('combobox', { name: 'Sprache' })).toBeInTheDocument();
	});

	it('renders one option per locale in display order', () => {
		renderSwitcher();
		const options = screen.getAllByRole('option');
		expect(options.map((o) => o.textContent)).toEqual([
			'English',
			'Deutsch',
			'العربية',
		]);
		expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
			'en-US',
			'de-AT',
			'ar',
		]);
	});

	it('reflects the controlled `current` value as the selected option', () => {
		renderSwitcher({ current: 'de-AT' });
		const select = screen.getByRole('combobox', { name: 'Language' });
		expect((select as HTMLSelectElement).value).toBe('de-AT');
		const selected = within(select).getByRole('option', {
			name: 'Deutsch',
			selected: true,
		});
		expect(selected).toBeInTheDocument();
	});

	it('calls onChange with the newly selected locale code', async () => {
		const { onChange } = renderSwitcher({ current: 'en-US' });
		const select = screen.getByRole('combobox', { name: 'Language' });

		await fireEvent.change(select, { target: { value: 'ar' } });

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith('ar');
	});

	it('associates the <label> with the <select> via a stable default id', () => {
		const { container } = renderSwitcher();
		const select = screen.getByRole('combobox', { name: 'Language' });
		expect(select.id).toBe('sentio-locale-switcher');
		const label = container.querySelector('label');
		expect(label?.getAttribute('for')).toBe('sentio-locale-switcher');
	});

	it('uses an explicit id for the select + label association when supplied', () => {
		const { container } = renderSwitcher({ id: 'header-locale' });
		const select = screen.getByRole('combobox', { name: 'Language' });
		expect(select.id).toBe('header-locale');
		expect(container.querySelector('label')?.getAttribute('for')).toBe('header-locale');
	});

	it('updates the selected value when the controlled prop changes', async () => {
		const { rerender } = renderSwitcher({ current: 'en-US' });
		const select = screen.getByRole('combobox', { name: 'Language' });
		expect((select as HTMLSelectElement).value).toBe('en-US');

		await rerender({ locales, current: 'ar', onChange: vi.fn() });
		expect((select as HTMLSelectElement).value).toBe('ar');
	});

	it('is axe-clean (WCAG 2.2 AA)', async () => {
		const { container } = renderSwitcher();
		await expectNoAxeViolations(container);
	});
});
