import { vi } from 'vitest';
import { type DpadNavigationOptions, dpadNavigation } from '../src/dpad-action';
import type { FocusCandidate, FocusGraphSource } from '../src/dpad';

// ---------------------------------------------------------------------------
// Fakes. The action is DOM/timer-bound; the test env is `node`, so we drive it
// with minimal stand-ins that expose exactly the surface the action touches:
// `node.addEventListener`/`removeEventListener`, `window.requestAnimationFrame`/
// `cancelAnimationFrame`, and `navigator.getGamepads`.
// ---------------------------------------------------------------------------

/** A keydown listener registry standing in for an HTMLElement. */
export class FakeNode {
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
export class FakeRaf {
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

export interface FakeButton {
	pressed: boolean;
}

export interface FakePad {
	buttons: FakeButton[];
	axes: number[];
}

/** Build a standard-layout gamepad with all buttons released + centred sticks. */
export function pad(overrides: Partial<FakePad> = {}): FakePad {
	const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
	return { buttons, axes: [0, 0], ...overrides };
}

/** Press a button index on a pad (mutates in place). */
export function press(p: FakePad, index: number): FakePad {
	p.buttons[index] = { pressed: true };
	return p;
}

// A simple linear focus graph: a — b — c at increasing x.
export function cell(id: string, cx: number): FocusCandidate {
	return { id, rect: { left: cx - 10, top: 90, right: cx + 10, bottom: 110 } };
}

export const candidates: FocusCandidate[] = [cell('a', 0), cell('b', 100), cell('c', 200)];

export function source(currentId: string | null): FocusGraphSource {
	return { candidates: () => candidates, current: () => currentId };
}

export function withRaf(gamepads: (FakePad | null)[]): FakeRaf {
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

export interface NavigationFixture {
	node: FakeNode;
	focus: ReturnType<typeof vi.fn<(id: string) => void>>;
	ret: ReturnType<typeof dpadNavigation>;
}

export function setupNavigation(
	options: Partial<DpadNavigationOptions> = {},
	startId: string | null = 'b',
): NavigationFixture {
	const node = new FakeNode();
	const focus =
		(options.focus as ReturnType<typeof vi.fn<(id: string) => void>> | undefined) ??
		vi.fn<(id: string) => void>();
	const ret = dpadNavigation(node as unknown as HTMLElement, {
		...source(startId),
		...options,
		focus,
	});
	return { node, focus, ret };
}

export function setupKeyboard(
	startId: string | null = 'b',
	options: Partial<DpadNavigationOptions> = {},
): NavigationFixture {
	return setupNavigation({ gamepadDisabled: true, ...options }, startId);
}

export interface GamepadFixture extends NavigationFixture {
	raf: FakeRaf;
}

export function setupGamepad(
	gamepads: (FakePad | null)[],
	options: Partial<DpadNavigationOptions> = {},
	startId: string | null = 'b',
): GamepadFixture {
	const raf = withRaf(gamepads);
	const fixture = setupNavigation(options, startId);
	return { raf, ...fixture };
}
