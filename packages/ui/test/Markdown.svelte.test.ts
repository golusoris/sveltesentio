// Component-render tests for Markdown.svelte: the live `{@html}` XSS boundary
// (ADR-0026). Beyond the string-level assertions in markdown-xss.test.ts, these
// mount the component and inspect the REAL DOM — proving sanitised markup renders
// as elements and that a `<script>` payload never becomes a live, executing node.
import { render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Markdown from '../src/markdown/Markdown.svelte';
import { expectNoAxeViolations } from './axe-helper.js';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('<Markdown>', () => {
	it('renders sanitised markdown as real DOM elements', () => {
		const { container } = render(Markdown, {
			source: '# Title\n\nSome **bold** and *em* text.',
		});

		const heading = within(container).getByRole('heading', { level: 1 });
		expect(heading).toHaveTextContent('Title');
		expect(container.querySelector('strong')).toHaveTextContent('bold');
		expect(container.querySelector('em')).toHaveTextContent('em');
	});

	it('renders a GFM table as a live <table> with header + body cells', () => {
		const { container } = render(Markdown, {
			source: '| a | b |\n|---|---|\n| 1 | 2 |',
		});

		const table = within(container).getByRole('table');
		expect(table).toBeInTheDocument();
		expect(within(table).getByRole('columnheader', { name: 'a' })).toBeInTheDocument();
		expect(within(table).getByRole('cell', { name: '1' })).toBeInTheDocument();
	});

	it('hardens external links (rel=noopener noreferrer + target=_blank)', () => {
		const { container } = render(Markdown, {
			source: '[ext](https://example.com)',
		});

		const link = within(container).getByRole('link', { name: 'ext' });
		expect(link).toHaveAttribute('href', 'https://example.com');
		expect(link).toHaveAttribute('rel', 'noopener noreferrer');
		expect(link).toHaveAttribute('target', '_blank');
	});

	it('exposes a labelled region when aria-label is supplied', () => {
		const { container } = render(Markdown, {
			source: 'content',
			'aria-label': 'Release notes',
		});

		const region = container.querySelector('[aria-label="Release notes"]');
		expect(region).toBeInTheDocument();
		expect(region).toHaveTextContent('content');
	});

	it('does NOT mount a <script> payload as a live DOM node (render-level XSS)', () => {
		// A global tripwire: if a sanitiser regression let a <script> execute, this
		// flips true. DOMPurify strips the tag entirely, so it must stay false.
		const tripwire = vi.fn();
		vi.stubGlobal('__xssPwned', tripwire);

		const { container } = render(Markdown, {
			source: 'before <script>globalThis.__xssPwned()</script> after',
		});

		// No <script> element in the live tree, and the payload text is gone.
		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelectorAll('script')).toHaveLength(0);
		expect(container.innerHTML).not.toContain('__xssPwned');
		// jsdom does not execute injected scripts, but the assertion documents the
		// security contract: the handler must never be reachable.
		expect(tripwire).not.toHaveBeenCalled();
		// Surrounding prose still renders (whitespace between fragments collapses).
		expect(container).toHaveTextContent(/before\s+after/);
	});

	it('does NOT mount an <img onerror> handler as a live attribute', () => {
		const { container } = render(Markdown, {
			source: '<img src=x onerror="globalThis.__xssPwned && globalThis.__xssPwned()">',
		});

		const img = container.querySelector('img');
		// The <img> may be dropped or kept, but the event handler must be gone.
		if (img) expect(img.hasAttribute('onerror')).toBe(false);
		expect(container.innerHTML).not.toContain('onerror');
	});

	it('re-sanitises when the source prop changes', async () => {
		const { container, rerender } = render(Markdown, { source: '# First' });
		expect(within(container).getByRole('heading', { level: 1 })).toHaveTextContent('First');

		await rerender({ source: '## Second <script>1</script>' });
		expect(within(container).getByRole('heading', { level: 2 })).toHaveTextContent('Second');
		expect(container.querySelector('script')).toBeNull();
	});

	it('is axe-clean for rendered markdown content', async () => {
		const { container } = render(Markdown, {
			source: '# Heading\n\nA paragraph with a [relative link](/docs).',
			'aria-label': 'Documentation',
		});
		await expectNoAxeViolations(container);
	});
});
