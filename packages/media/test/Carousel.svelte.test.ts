import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Harness from './CarouselHarness.svelte';
import { expectNoAxeViolations } from './axe-helper.js';

describe('Carousel', () => {
	it('exposes a region with a carousel roledescription and the supplied label', () => {
		const { getByRole } = render(Harness, { label: 'Featured titles' });
		const region = getByRole('region', { name: 'Featured titles' });
		expect(region).toHaveAttribute('aria-roledescription', 'carousel');
	});

	it('renders the slotted slides', () => {
		const { getByTestId } = render(Harness, { label: 'Featured titles' });
		expect(getByTestId('slide-1')).toHaveTextContent('Slide 1');
		expect(getByTestId('slide-3')).toHaveTextContent('Slide 3');
	});

	it('renders accessible prev/next nav buttons', () => {
		const { getByRole } = render(Harness, { label: 'Featured titles' });
		expect(getByRole('button', { name: 'Previous slide' })).toBeInTheDocument();
		expect(getByRole('button', { name: 'Next slide' })).toBeInTheDocument();
	});

	it('sizes nav buttons to the 32px desktop target by default', () => {
		const { getByRole } = render(Harness, { label: 'Featured titles' });
		const next = getByRole('button', { name: 'Next slide' }) as HTMLElement;
		expect(next.style.minWidth).toBe('32px');
		expect(next.style.minHeight).toBe('32px');
	});

	it('upgrades nav buttons to the 44px target on the handheld preset', () => {
		const { getByRole } = render(Harness, { label: 'Featured titles', preset: 'handheld' });
		const next = getByRole('button', { name: 'Next slide' }) as HTMLElement;
		expect(next.style.minWidth).toBe('44px');
		expect(next.style.minHeight).toBe('44px');
	});

	it('degrades to a native scroll-snap viewport when no embla action is provided', () => {
		const { container } = render(Harness, { label: 'Featured titles' });
		expect(
			container.querySelector('.ssentio-carousel__viewport--native'),
		).toBeInTheDocument();
	});

	it('is axe-clean (WCAG 2.2 AA)', async () => {
		const { container } = render(Harness, { label: 'Featured titles' });
		await expectNoAxeViolations(container);
	});
});
