import { render, fireEvent } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Image from '../src/Image.svelte';
import { expectNoAxeViolations } from './axe-helper.js';

describe('Image', () => {
	it('renders an <img> with the required alt text', () => {
		const { getByRole } = render(Image, { src: '/hero.jpg', alt: 'A scenic ridge' });
		const img = getByRole('img', { name: 'A scenic ridge' });
		expect(img).toBeInTheDocument();
	});

	it('builds a srcset + sizes from the supplied widths', () => {
		const { getByRole } = render(Image, {
			src: '/hero.jpg',
			alt: 'A scenic ridge',
			widths: [320, 640, 1280],
			sizes: [{ condition: '(min-width: 768px)', size: '50vw' }],
		});
		const img = getByRole('img');
		expect(img.getAttribute('srcset')).toBe(
			'/hero.jpg?w=320 320w, /hero.jpg?w=640 640w, /hero.jpg?w=1280 1280w',
		);
		expect(img.getAttribute('sizes')).toBe('(min-width: 768px) 50vw, 100vw');
	});

	it('omits srcset and sizes when no widths are given', () => {
		const { getByRole } = render(Image, { src: '/hero.jpg', alt: 'A scenic ridge' });
		const img = getByRole('img');
		expect(img.hasAttribute('srcset')).toBe(false);
		expect(img.hasAttribute('sizes')).toBe(false);
		expect(img).toHaveAttribute('src', '/hero.jpg');
	});

	it('reserves layout space via an aspect-ratio from width/height', () => {
		const { container } = render(Image, {
			src: '/hero.jpg',
			alt: 'A scenic ridge',
			width: 1600,
			height: 900,
		});
		const wrapper = container.querySelector('.ssentio-image') as HTMLElement;
		expect(wrapper.style.aspectRatio).toBe('1600 / 900');
	});

	it('renders an aria-hidden LQIP layer until the image loads, then removes it', async () => {
		const { container, getByRole } = render(Image, {
			src: '/hero.jpg',
			alt: 'A scenic ridge',
			placeholder: { color: '#222' },
		});
		const lqip = container.querySelector('.ssentio-image__lqip');
		expect(lqip).toBeInTheDocument();
		expect(lqip).toHaveAttribute('aria-hidden', 'true');

		await fireEvent.load(getByRole('img'));
		expect(container.querySelector('.ssentio-image__lqip')).toBeNull();
	});

	it('eager-loads with fetchpriority="high" for a priority hero', () => {
		const { getByRole } = render(Image, {
			src: '/hero.jpg',
			alt: 'A scenic ridge',
			priority: 'high',
		});
		const img = getByRole('img');
		expect(img).toHaveAttribute('loading', 'eager');
		expect(img).toHaveAttribute('fetchpriority', 'high');
		expect(img).toHaveAttribute('decoding', 'async');
	});

	it('lazy-loads by default', () => {
		const { getByRole } = render(Image, { src: '/hero.jpg', alt: 'A scenic ridge' });
		const img = getByRole('img');
		expect(img).toHaveAttribute('loading', 'lazy');
		expect(img).toHaveAttribute('fetchpriority', 'auto');
	});

	it('is axe-clean (WCAG 2.2 AA) with a placeholder', async () => {
		const { container } = render(Image, {
			src: '/hero.jpg',
			alt: 'A scenic ridge',
			placeholder: { color: '#222' },
			width: 1600,
			height: 900,
		});
		await expectNoAxeViolations(container);
	});

	it('is axe-clean for a decorative image (empty alt)', async () => {
		const { container } = render(Image, { src: '/decoration.svg', alt: '' });
		await expectNoAxeViolations(container);
	});
});
