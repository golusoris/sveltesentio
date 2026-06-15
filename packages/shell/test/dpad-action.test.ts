import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DpadNavigationOptions, dpadNavigation } from '../src/dpad-action';
import type { FocusCandidate, FocusGraphSource } from '../src/dpad';

// ---------------------------------------------------------------------------
// Fakes. The action is DOM/timer-bound; the test env is `node`, so we drive it
// with minimal stand-ins that expose exactly the surface the action touches:
// `node.addEventListener`/`removeEventListener`, `window.requestAnimationFrame`/
// `cancelAnimationFrame`, and `navigator.getGamepads`.
// ---------------------------------------------------------------------------

/** A keydown listener registry standing in for an HTMLElement. */
class FakeNode {
	readonly listeners = new Map<string, Set<(event: Event) => void>>();

	addEventListener(type: string, handler: (event: Event) => void): void {
		const set = this.listeners.get(type) ?? new Set();
		set.add(handler);
		this.listeners.set(type, set);
	}

	removeEventListener(type: string, handler: (event: Event) => void): void {
		this.listeners.get(type)?.delete(handler);
	}

	/** Number of live listeners for a type (asserts attach/detach). */
	count(type: string): number {
		return this.listeners.get(type)?.size ?? 0;
	}

	/** Dispatch a fake keydown carrying `key`; returns the event for assertions. */
	keydown(key: string): { key: string; preventDefault: () => void; prevented: boolean } {
		let prevented = false;
		const event = {
			key,
			preventDefault: () => {
				prevented = true;
			},
			get prevented() {
				return prevented;
			},
		};
		for (const handler of this.listeners.get('keydown') ?? []) {
			handler(event as unknown as Event);
		}
		return event;
	}
}

/** A hand-cranked rAF: callbacks queue up and only fire when `tick` is called. */
class FakeRaf {
	private nextId = 1;
	private queued = new Map<number, FrameRequestCallback>();
	cancelled: number[] = [];

	readonly requestAnimationFrame = (cb: FrameRequestCallback): number => {
		const id = this.nextId++;
		this.queued.set(id, cb);
		return id;
	};

	readonly cancelAnimationFrame = (id: number): void => {
		this.cancelled.push(id);
		this.queued.delete(id);
	};

	/** Run the single pending callback (the action re-schedules one per frame). */
	tick(timestamp: number): void {
		const entries = [...this.queued.entries()];
		this.queued.clear();
		for (const [, cb] of entries) cb(timestamp);
	}

	get pending(): number {
		return this.queued.size;
	}
}

interface FakeButton {
	pressed: boolean;
}
interface FakePad {
	buttons: FakeButton[];
	axes: number[];
}

/** Build a standard-layout gamepad with all buttons released + centred sticks. */
function pad(overrides: Partial<FakePad> = {}): FakePad {
	const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
	return { buttons, axes: [0, 0], ...overrides };
}

/** Press a button index on a pad (mutates in place). */
function press(p: FakePad, index: number): FakePad {
	p.buttons[index] = { pressed: true };
	return p;
}

// A simple linear focus graph: a — b — c at increasing x.
function cell(id: string, cx: number): FocusCandidate {
	return { id, rect: { left: cx - 10, top: 90, right: cx + 10, bottom: 110 } };
}
const candidates: FocusCandidate[] = [cell('a', 0), cell('b', 100), cell('c', 200)];

function source(currentId: string | null): FocusGraphSource {
	return { candidates: () => candidates, current: () => currentId };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Keyboard path (no window / navigator needed).
// ---------------------------------------------------------------------------

describe('dpadNavigation — keyboard', () => {
	it('attaches a keydown listener and detaches it on destroy', () => {
		const node = new FakeNode();
		const focus = vi.fn();
		const ret = dpadNavigation(node as unknown as HTMLElement, {
			...source('b'),
			focus,
			gamepadDisabled: true,
		});

		expect(node.count('keydown')).toBe(1);
		ret?.destroy?.();
		expect(node.count('keydown')).toBe(0);
	});

	it('moves focus one cell on an arrow press and prevents the default', () => {
		const node = new FakeNode();
		const focus = vi.fn();
		dpadNavigation(node as unknown as HTMLElement, {
			...source('b'),
			focus,
			gamepadDisabled: true,
		});

		const event = node.keydown('ArrowRight');
		expect(focus).toHaveBeenCalledExactlyOnceWith('c');
		expect(event.prevented).toBe(true);

		node.keydown('ArrowLeft');
		expect(focus).toHaveBeenLastCalledWith('a');
	});

	it('ignores non-arrow keys without preventing default or moving focus', () => {
		const node = new FakeNode();
		const focus = vi.fn();
		dpadNavigation(node as unknown as HTMLElement, {
			...source('b'),
			focus,
			gamepadDisabled: true,
		});

		const event = node.keydown('Enter');
		expect(focus).not.toHaveBeenCalled();
		expect(event.prevented).toBe(false);
	});

	it('does not call focus when the move resolves to null (edge of graph)', () => {
		const node = new FakeNode();
		const focus = vi.fn();
		dpadNavigation(node as unknown as HTMLElement, {
			...source('c'), // rightmost cell — no neighbour to the right
			focus,
			gamepadDisabled: true,
		});

		const event = node.keydown('ArrowRight');
		expect(focus).not.toHaveBeenCalled();
		// The arrow key is still consumed even when no move happens.
		expect(event.prevented).toBe(true);
	});

	it('reads live options via update(): swapped focus + current take effect', () => {
		const node = new FakeNode();
		const firstFocus = vi.fn();
		const secondFocus = vi.fn();
		const ret = dpadNavigation(node as unknown as HTMLElement, {
			...source('b'),
			focus: firstFocus,
			gamepadDisabled: true,
		});

		const next: DpadNavigationOptions = {
			...source('a'),
			focus: secondFocus,
			gamepadDisabled: true,
		};
		ret?.update?.(next);

		node.keydown('ArrowRight');
		expect(firstFocus).not.toHaveBeenCalled();
		expect(secondFocus).toHaveBeenCalledExactlyOnceWith('b'); // from 'a' → right → 'b'
	});
});

// ---------------------------------------------------------------------------
// Gamepad path (requires window + navigator stubs).
// ---------------------------------------------------------------------------

describe('dpadNavigation — gamepad', () => {
	function withRaf(gamepads: (FakePad | null)[]): FakeRaf {
		const raf = new FakeRaf();
		vi.stubGlobal('window', {
			requestAnimationFrame: raf.requestAnimationFrame,
			cancelAnimationFrame: raf.cancelAnimationFrame,
		});
		vi.stubGlobal('navigator', {
			getGamepads: () => gamepads,
		});
		return raf;
	}

	it('schedules a poll loop when a gamepad is available and cancels it on destroy', () => {
		const raf = withRaf([pad()]);
		const node = new FakeNode();
		const ret = dpadNavigation(node as unknown as HTMLElement, {
			...source('b'),
			focus: vi.fn(),
		});

		expect(raf.pending).toBe(1); // one frame queued at attach
		ret?.destroy?.();
		expect(raf.cancelled).toHaveLength(1);
	});

	it('edge-triggers a D-pad press into a single focus move (no hold-repeat)', () => {
		const live = pad();
		const raf = withRaf([live]);
		const node = new FakeNode();
		const focus = vi.fn();
		dpadNavigation(node as unknown as HTMLElement, { ...source('b'), focus });

		// Frame 1: button 15 (right D-pad) freshly pressed → one move.
		press(live, 15);
		raf.tick(16);
		expect(focus).toHaveBeenCalledExactlyOnceWith('c');

		// Frame 2: still held → no repeat.
		raf.tick(32);
		expect(focus).toHaveBeenCalledTimes(1);

		// Release then re-press → fires again.
		live.buttons[15] = { pressed: false };
		raf.tick(48);
		press(live, 15);
		raf.tick(64);
		expect(focus).toHaveBeenCalledTimes(2);
	});

	it('honours the poll interval: frames inside the window are skipped', () => {
		const live = pad();
		const raf = withRaf([live]);
		const node = new FakeNode();
		const focus = vi.fn();
		dpadNavigation(node as unknown as HTMLElement, {
			...source('b'),
			focus,
			pollInterval: 100,
		});

		press(live, 15);
		raf.tick(0); // lastPoll was 0 → 0-0 < 100, this frame is skipped
		expect(focus).not.toHaveBeenCalled();

		raf.tick(150); // 150-0 >= 100 → polled
		expect(focus).toHaveBeenCalledExactlyOnceWith('c');
	});

	it('maps the left analog stick past the deadzone to a move', () => {
		const live = pad({ axes: [-0.9, 0] }); // hard left
		const raf = withRaf([live]);
		const node = new FakeNode();
		const focus = vi.fn();
		dpadNavigation(node as unknown as HTMLElement, { ...source('b'), focus });

		raf.tick(16);
		expect(focus).toHaveBeenCalledExactlyOnceWith('a');
	});

	it('skips disconnected (null) pad slots without throwing', () => {
		const live = press(pad(), 14); // left D-pad
		const raf = withRaf([null, live, null]);
		const node = new FakeNode();
		const focus = vi.fn();
		dpadNavigation(node as unknown as HTMLElement, { ...source('b'), focus });

		raf.tick(16);
		expect(focus).toHaveBeenCalledExactlyOnceWith('a');
	});

	it('does not start polling when gamepadDisabled is set', () => {
		const raf = withRaf([pad()]);
		const node = new FakeNode();
		dpadNavigation(node as unknown as HTMLElement, {
			...source('b'),
			focus: vi.fn(),
			gamepadDisabled: true,
		});

		expect(raf.pending).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// SSR / no-gamepad-API safety: action attaches keyboard only and destroys clean.
// ---------------------------------------------------------------------------

describe('dpadNavigation — environment safety', () => {
	it('does not schedule a poll loop when the Gamepad API is absent', () => {
		// navigator exists but without getGamepads (older / locked-down UA).
		const raf = new FakeRaf();
		vi.stubGlobal('window', {
			requestAnimationFrame: raf.requestAnimationFrame,
			cancelAnimationFrame: raf.cancelAnimationFrame,
		});
		vi.stubGlobal('navigator', {});

		const node = new FakeNode();
		const ret = dpadNavigation(node as unknown as HTMLElement, {
			...source('b'),
			focus: vi.fn(),
		});

		expect(raf.pending).toBe(0);
		// Keyboard still works.
		expect(node.count('keydown')).toBe(1);
		// destroy() must not throw even though no rAF was scheduled.
		expect(() => ret?.destroy?.()).not.toThrow();
		expect(raf.cancelled).toHaveLength(0);
	});

	it('attaches keyboard-only when navigator is undefined entirely', () => {
		// No navigator stub: `typeof navigator !== 'undefined'` short-circuits.
		const node = new FakeNode();
		const focus = vi.fn();
		const ret = dpadNavigation(node as unknown as HTMLElement, {
			...source('b'),
			focus,
		});

		node.keydown('ArrowRight');
		expect(focus).toHaveBeenCalledExactlyOnceWith('c');
		expect(() => ret?.destroy?.()).not.toThrow();
	});
});
