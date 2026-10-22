import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DpadNavigationOptions } from '../src/dpad-action';
import {
	FakeRaf,
	pad,
	press,
	setupGamepad,
	setupKeyboard,
	setupNavigation,
	source,
} from './dpad-action-helper';

afterEach(() => {
	vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Keyboard path (no window / navigator needed).
// ---------------------------------------------------------------------------

describe('dpadNavigation — keyboard', () => {
	it('attaches a keydown listener and detaches it on destroy', () => {
		const { node, ret } = setupKeyboard();

		expect(node.count('keydown')).toBe(1);
		ret?.destroy?.();
		expect(node.count('keydown')).toBe(0);
	});

	it('moves focus one cell on an arrow press and prevents the default', () => {
		const { node, focus } = setupKeyboard();

		const event = node.keydown('ArrowRight');
		expect(focus).toHaveBeenCalledExactlyOnceWith('c');
		expect(event.prevented).toBe(true);

		node.keydown('ArrowLeft');
		expect(focus).toHaveBeenLastCalledWith('a');
	});

	it('ignores non-arrow keys without preventing default or moving focus', () => {
		const { node, focus } = setupKeyboard();

		const event = node.keydown('Enter');
		expect(focus).not.toHaveBeenCalled();
		expect(event.prevented).toBe(false);
	});

	it('does not call focus when the move resolves to null (edge of graph)', () => {
		const { node, focus } = setupKeyboard('c');

		const event = node.keydown('ArrowRight');
		expect(focus).not.toHaveBeenCalled();
		// The arrow key is still consumed even when no move happens.
		expect(event.prevented).toBe(true);
	});

	it('reads live options via update(): swapped focus + current take effect', () => {
		const firstFocus = vi.fn();
		const secondFocus = vi.fn();
		const { node, ret } = setupKeyboard('b', { focus: firstFocus });

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
	it('schedules a poll loop when a gamepad is available and cancels it on destroy', () => {
		const { raf, ret } = setupGamepad([pad()]);

		expect(raf.pending).toBe(1); // one frame queued at attach
		ret?.destroy?.();
		expect(raf.cancelled).toHaveLength(1);
	});

	it('edge-triggers a D-pad press into a single focus move (no hold-repeat)', () => {
		const live = pad();
		const { raf, focus } = setupGamepad([live]);

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
		const { raf, focus } = setupGamepad([live], { pollInterval: 100 });

		press(live, 15);
		raf.tick(0); // lastPoll was 0 → 0-0 < 100, this frame is skipped
		expect(focus).not.toHaveBeenCalled();

		raf.tick(150); // 150-0 >= 100 → polled
		expect(focus).toHaveBeenCalledExactlyOnceWith('c');
	});

	it('maps the left analog stick past the deadzone to a move', () => {
		const live = pad({ axes: [-0.9, 0] }); // hard left
		const { raf, focus } = setupGamepad([live]);

		raf.tick(16);
		expect(focus).toHaveBeenCalledExactlyOnceWith('a');
	});

	it('skips disconnected (null) pad slots without throwing', () => {
		const live = press(pad(), 14); // left D-pad
		const { raf, focus } = setupGamepad([null, live, null]);

		raf.tick(16);
		expect(focus).toHaveBeenCalledExactlyOnceWith('a');
	});

	it('does not start polling when gamepadDisabled is set', () => {
		const { raf } = setupGamepad([pad()], { gamepadDisabled: true });

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

		const { node, ret } = setupNavigation();

		expect(raf.pending).toBe(0);
		// Keyboard still works.
		expect(node.count('keydown')).toBe(1);
		// destroy() must not throw even though no rAF was scheduled.
		expect(() => ret?.destroy?.()).not.toThrow();
		expect(raf.cancelled).toHaveLength(0);
	});

	it('attaches keyboard-only when navigator is undefined entirely', () => {
		// No navigator stub: `typeof navigator !== 'undefined'` short-circuits.
		const { node, focus, ret } = setupNavigation();

		node.keydown('ArrowRight');
		expect(focus).toHaveBeenCalledExactlyOnceWith('c');
		expect(() => ret?.destroy?.()).not.toThrow();
	});
});
