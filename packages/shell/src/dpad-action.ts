// Svelte `use:` action wiring keyboard arrows + the Gamepad API to the pure
// focus-graph engine in `dpad.ts`. DOM/timer-bound, untested by design (the
// geometry + input mapping it delegates to is fully covered). SSR-safe.

import type { Action } from 'svelte/action';
import {
	type Direction,
	type FocusGraphSource,
	directionFromAxes,
	directionFromGamepadButton,
	directionFromKey,
	resolveNextFocus,
} from './dpad.js';

/** Options for the {@link dpadNavigation} action. */
export interface DpadNavigationOptions extends FocusGraphSource {
	/** Move focus to `id`. The action never touches the DOM itself. */
	readonly focus: (id: string) => void;
	/** Poll interval (ms) for the Gamepad API. Defaults to ~60fps. */
	readonly pollInterval?: number;
	/** Disable gamepad polling (keyboard-only). Defaults to `false`. */
	readonly gamepadDisabled?: boolean;
}

/**
 * Svelte action: arrow keys + Gamepad D-pad / left stick navigate the focus
 * graph one cell per discrete press.
 *
 * @example
 * ```svelte
 * <div use:dpadNavigation={{ candidates, current, focus }}>…</div>
 * ```
 */
export const dpadNavigation: Action<HTMLElement, DpadNavigationOptions> = (
	node,
	initial,
) => {
	let options = initial;

	function move(direction: Direction): void {
		const next = resolveNextFocus(options, direction);
		if (next !== null) options.focus(next);
	}

	function onKeydown(event: KeyboardEvent): void {
		const direction = directionFromKey(event.key);
		if (direction === null) return;
		event.preventDefault();
		move(direction);
	}

	node.addEventListener('keydown', onKeydown);

	let rafId: number | null = null;
	const pressed = new Set<Direction>();
	const interval = options.pollInterval ?? 16;
	let lastPoll = 0;

	function pollGamepads(timestamp: number): void {
		rafId = window.requestAnimationFrame(pollGamepads);
		if (timestamp - lastPoll < interval) return;
		lastPoll = timestamp;

		const pads = navigator.getGamepads?.() ?? [];
		const active = new Set<Direction>();
		for (const pad of pads) {
			if (pad === null) continue;
			pad.buttons.forEach((button, index) => {
				if (!button.pressed) return;
				const direction = directionFromGamepadButton(index);
				if (direction !== null) active.add(direction);
			});
			const axisDirection = directionFromAxes(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
			if (axisDirection !== null) active.add(axisDirection);
		}

		// Edge-trigger: fire only on a fresh press. One cell per discrete press —
		// no hold-to-repeat (reduced-motion-friendly; repeat lives upstream).
		for (const direction of active) {
			if (!pressed.has(direction)) move(direction);
		}
		pressed.clear();
		for (const direction of active) pressed.add(direction);
	}

	const gamepadEnabled =
		!options.gamepadDisabled &&
		typeof navigator !== 'undefined' &&
		'getGamepads' in navigator;
	if (gamepadEnabled) {
		rafId = window.requestAnimationFrame(pollGamepads);
	}

	return {
		update(next: DpadNavigationOptions): void {
			options = next;
		},
		destroy(): void {
			node.removeEventListener('keydown', onKeydown);
			if (rafId !== null) window.cancelAnimationFrame(rafId);
		},
	};
};
