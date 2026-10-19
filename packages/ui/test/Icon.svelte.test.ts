// Component-render tests for Icon.svelte: the decorative-vs-labelled a11y
// contract (ADR-0002). Icon resolves a component from the global registry, so a
// stub loader returning `StubIcon` (an <svg>) is installed per-test; the stub
// forwards the a11y attributes Icon computes onto a real element axe can read.
import { render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Icon from '../src/icons/Icon.svelte';
import StubIcon from './StubIcon.svelte';
import { IconRegistry, __setRegistry, type IconLoader } from '../src/icons/registry.js';
import { createLucideLoader } from '../src/icons/lucide.js';
import { expectNoAxeViolations } from './axe-helper.js';

// A loader that resolves only the names the tests use; everything else misses so
// Icon falls back to its empty `aria-hidden` placeholder. `IconComponent` is
// `NonNullable<unknown>`, so the StubIcon component value satisfies it directly.
const stubLoader: IconLoader = (name) => (name === 'arrow-left' ? StubIcon : undefined);

beforeEach(() => {
	__setRegistry(new IconRegistry([stubLoader]));
});

afterEach(() => {
	// Reset the process-wide registry so cases never leak loaders into each other.
	__setRegistry(new IconRegistry());
});

describe('<Icon>', () => {
	it('renders the resolved icon component for a known name', () => {
		render(Icon, { name: 'arrow-left' });
		expect(screen.getByTestId('stub-icon')).toBeInTheDocument();
	});

	it('is decorative (aria-hidden, no role/label) when no label is given', () => {
		render(Icon, { name: 'arrow-left' });
		const svg = screen.getByTestId('stub-icon');

		expect(svg).toHaveAttribute('aria-hidden', 'true');
		expect(svg).not.toHaveAttribute('role');
		expect(svg).not.toHaveAttribute('aria-label');
	});

	it('is meaningful (role=img + aria-label, no aria-hidden) when labelled', () => {
		render(Icon, { name: 'arrow-left', label: 'Go back' });
		const img = screen.getByRole('img', { name: 'Go back' });

		expect(img).toHaveAttribute('role', 'img');
		expect(img).toHaveAttribute('aria-label', 'Go back');
		expect(img).not.toHaveAttribute('aria-hidden');
	});

	it('forwards the size prop to the rendered icon width/height', () => {
		render(Icon, { name: 'arrow-left', size: 32 });
		const svg = screen.getByTestId('stub-icon');

		expect(svg).toHaveAttribute('width', '32');
		expect(svg).toHaveAttribute('height', '32');
	});

	it('forwards the class prop to the rendered icon', () => {
		render(Icon, { name: 'arrow-left', class: 'text-accent' });
		expect(screen.getByTestId('stub-icon')).toHaveClass('text-accent');
	});

	it('renders a decorative placeholder for an unresolved name', () => {
		const { container } = render(Icon, { name: 'no-such-icon' });

		// No icon component resolved → no <svg>; the placeholder <span> is present,
		// sized, and hidden from assistive tech.
		expect(screen.queryByTestId('stub-icon')).toBeNull();
		const placeholder = container.querySelector('span[aria-hidden="true"]');
		expect(placeholder).toBeInTheDocument();
		expect(placeholder).toHaveStyle({ display: 'inline-block' });
	});

	it('switches from decorative to labelled when the label prop changes', async () => {
		const { rerender } = render(Icon, { name: 'arrow-left' });
		expect(screen.getByTestId('stub-icon')).toHaveAttribute('aria-hidden', 'true');

		await rerender({ name: 'arrow-left', label: 'Go back' });
		const img = screen.getByRole('img', { name: 'Go back' });
		expect(img).not.toHaveAttribute('aria-hidden');
	});

	it('is axe-clean when decorative', async () => {
		const { container } = render(Icon, { name: 'arrow-left' });
		await expectNoAxeViolations(container);
	});

	it('is axe-clean when labelled', async () => {
		const { container } = render(Icon, { name: 'arrow-left', label: 'Go back' });
		await expectNoAxeViolations(container);
	});

	it('positive: renders an icon when an async loader resolves', async () => {
		const asyncLoader: IconLoader = (name) =>
			name === 'async-icon' ? Promise.resolve(StubIcon) : undefined;
		__setRegistry(new IconRegistry([asyncLoader]));

		render(Icon, { name: 'async-icon' });
		const svg = await screen.findByTestId('stub-icon');
		expect(svg).toBeInTheDocument();
	});

	it('positive: renders an icon via createLucideLoader and static wiring', () => {
		const loader = createLucideLoader({ ArrowLeft: StubIcon });
		__setRegistry(new IconRegistry([loader]));

		render(Icon, { name: 'arrow-left' });
		expect(screen.getByTestId('stub-icon')).toBeInTheDocument();
	});

	it('negative: handles a rejected loader promise without unhandled rejection and reports once via console.error', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failingLoader: IconLoader = (name) =>
			name === 'failing-icon'
				? Promise.reject(new Error('Module not found: @lucide/svelte/icons/failing-icon'))
				: undefined;
		__setRegistry(new IconRegistry([failingLoader]));

		const { container } = render(Icon, { name: 'failing-icon' });

		await new Promise((r) => setTimeout(r, 10));

		// No svg rendered; decorative placeholder remains
		expect(screen.queryByTestId('stub-icon')).toBeNull();
		const placeholder = container.querySelector('span[aria-hidden="true"]');
		expect(placeholder).toBeInTheDocument();

		// console.error called once with the icon name, loader failure, and remedy
		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringMatching(/failing-icon.*loader failure.*static loader/i),
			expect.any(Error),
		);

		errorSpy.mockRestore();
	});

	it('boundary: reports once for multiple Icon instances with the same failing name', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failingLoader: IconLoader = (name) =>
			name === 'duplicate-fail' ? Promise.reject(new Error('Network error')) : undefined;
		__setRegistry(new IconRegistry([failingLoader]));

		render(Icon, { name: 'duplicate-fail' });
		render(Icon, { name: 'duplicate-fail' });

		await new Promise((r) => setTimeout(r, 10));

		expect(screen.queryByTestId('stub-icon')).toBeNull();
		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('duplicate-fail'),
			expect.any(Error),
		);

		errorSpy.mockRestore();
	});

	it('boundary: a resolve after unmount does not render', async () => {
		let resolveDelayed!: (comp: typeof StubIcon) => void;
		const delayedPromise = new Promise<typeof StubIcon>((resolve) => {
			resolveDelayed = resolve;
		});
		const delayedLoader: IconLoader = (name) =>
			name === 'delayed-icon' ? delayedPromise : undefined;
		__setRegistry(new IconRegistry([delayedLoader]));

		const { unmount } = render(Icon, { name: 'delayed-icon' });
		expect(screen.queryByTestId('stub-icon')).toBeNull();

		unmount();

		// Resolve after unmount
		resolveDelayed(StubIcon);
		await new Promise((r) => setTimeout(r, 10));

		expect(screen.queryByTestId('stub-icon')).toBeNull();
	});
});
