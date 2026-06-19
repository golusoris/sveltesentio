// Component-render tests for ChatStream.svelte: the accessible transcript
// contract. The component is presentation-only (no transport), so the tests
// drive it directly with `messages` + `streaming` props.
import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ChatStream from '../src/ChatStream.svelte';
import type { ChatMessage } from '../src/proxy.js';
import { expectNoAxeViolations } from './axe-helper.js';

const conversation: ChatMessage[] = [
	{ role: 'user', content: 'What is SvelteKit?' },
	{ role: 'assistant', content: 'A framework for building web apps with Svelte.' },
];

describe('<ChatStream>', () => {
	it('renders each turn with its role label and content inside a log region', () => {
		render(ChatStream, { messages: conversation });

		const log = screen.getByRole('log');
		expect(log).toHaveAttribute('aria-live', 'polite');
		expect(within(log).getByText('You')).toBeInTheDocument();
		expect(within(log).getByText('Assistant')).toBeInTheDocument();
		expect(within(log).getByText('What is SvelteKit?')).toBeInTheDocument();
		expect(
			within(log).getByText('A framework for building web apps with Svelte.'),
		).toBeInTheDocument();
		// List semantics are preserved on the inner <ol> (one item per turn).
		expect(within(log).getAllByRole('listitem')).toHaveLength(2);
	});

	it('exposes a labelled region using the default label', () => {
		const { container } = render(ChatStream, { messages: conversation });
		const region = container.querySelector('[aria-label="Conversation"]');
		expect(region).toBeInTheDocument();
	});

	it('applies a custom region label and role labels', () => {
		const { container } = render(ChatStream, {
			messages: [{ role: 'assistant', content: 'Hi' }],
			label: 'Support chat',
			roleLabels: { assistant: 'Bot' },
		});

		expect(container.querySelector('[aria-label="Support chat"]')).toBeInTheDocument();
		expect(screen.getByText('Bot')).toBeInTheDocument();
	});

	it('shows a status indicator only while streaming', () => {
		const { rerender } = render(ChatStream, { messages: conversation, streaming: false });
		expect(screen.queryByRole('status')).toBeNull();

		return rerender({ messages: conversation, streaming: true }).then(() => {
			const status = screen.getByRole('status');
			expect(status).toHaveTextContent('Assistant is responding…');
		});
	});

	it('uses a custom streaming label', () => {
		render(ChatStream, {
			messages: conversation,
			streaming: true,
			streamingLabel: 'Thinking…',
		});
		expect(screen.getByRole('status')).toHaveTextContent('Thinking…');
	});

	it('renders an empty but valid log when there are no messages', () => {
		const { container } = render(ChatStream, { messages: [] });
		const log = screen.getByRole('log');
		expect(log).toBeInTheDocument();
		// No turns are rendered; the list has no items and no status indicator.
		expect(screen.queryAllByRole('listitem')).toHaveLength(0);
		expect(container.querySelector('.ssentio-chat__status')).toBeNull();
	});

	it('is axe-clean with a populated transcript', async () => {
		const { container } = render(ChatStream, { messages: conversation });
		await expectNoAxeViolations(container);
	});

	it('is axe-clean while streaming', async () => {
		const { container } = render(ChatStream, {
			messages: conversation,
			streaming: true,
		});
		await expectNoAxeViolations(container);
	});
});
