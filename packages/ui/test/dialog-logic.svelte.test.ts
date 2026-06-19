// Pure dialog-logic tests. `focusableElements`/`nextTrapTarget` touch the DOM
// (`querySelectorAll`, `instanceof HTMLElement`), so this suite runs in the jsdom
// `components` project (named `*.svelte.test.ts`) even though it imports no
// component. The string-class helpers are exercised here too.
import { describe, expect, it } from 'vitest';
import {
	DIALOG_CONTENT,
	DIALOG_OVERLAY,
	dialogContentClass,
	focusableElements,
	nextTrapTarget,
} from '../src/dialog/dialog.js';

function fixture(html: string): HTMLElement {
	const host = document.createElement('div');
	host.innerHTML = html;
	document.body.appendChild(host);
	return host;
}

describe('dialogContentClass', () => {
	it('returns the content base by default', () => {
		expect(dialogContentClass()).toBe(DIALOG_CONTENT.replace(/\s+/g, ' ').trim());
	});

	it('appends consumer className last and collapses whitespace', () => {
		const cls = dialogContentClass('max-w-2xl');
		expect(cls.endsWith('max-w-2xl')).toBe(true);
		expect(cls).not.toMatch(/\s{2,}/);
	});

	it('exposes a fixed/overlay base for the backdrop', () => {
		expect(DIALOG_OVERLAY).toContain('fixed');
		expect(DIALOG_OVERLAY).toContain('inset-0');
	});
});

describe('focusableElements', () => {
	it('collects enabled focusables in document order, skipping disabled + tabindex=-1', () => {
		const host = fixture(`
			<a href="#a">a</a>
			<button>b</button>
			<button disabled>disabled</button>
			<input />
			<input disabled />
			<div tabindex="0">d</div>
			<div tabindex="-1">skip</div>
		`);
		const els = focusableElements(host);
		expect(els.map((e) => e.textContent || e.tagName.toLowerCase())).toEqual([
			'a',
			'b',
			'input',
			'd',
		]);
	});

	it('returns an empty list when nothing is focusable', () => {
		expect(focusableElements(fixture('<p>text</p>'))).toEqual([]);
	});
});

describe('nextTrapTarget', () => {
	function threeButtons(): HTMLElement[] {
		const host = fixture('<button>1</button><button>2</button><button>3</button>');
		return focusableElements(host);
	}

	it('returns undefined when there is nothing to trap', () => {
		expect(nextTrapTarget([], null, false)).toBeUndefined();
	});

	it('forward off the last element wraps to the first', () => {
		const els = threeButtons();
		expect(nextTrapTarget(els, els[2] ?? null, false)).toBe(els[0]);
	});

	it('backward off the first element wraps to the last', () => {
		const els = threeButtons();
		expect(nextTrapTarget(els, els[0] ?? null, true)).toBe(els[2]);
	});

	it('moves forward one step from a middle element', () => {
		const els = threeButtons();
		expect(nextTrapTarget(els, els[1] ?? null, false)).toBe(els[2]);
	});

	it('moves backward one step from a middle element', () => {
		const els = threeButtons();
		expect(nextTrapTarget(els, els[1] ?? null, true)).toBe(els[0]);
	});

	it('snaps focus from outside the trap to first (forward) or last (backward)', () => {
		const els = threeButtons();
		expect(nextTrapTarget(els, null, false)).toBe(els[0]);
		expect(nextTrapTarget(els, null, true)).toBe(els[2]);
	});
});
