// Directional (D-pad / spatial) focus navigation — pure geometry + input
// mapping. Framework-agnostic and fully unit-tested. The Svelte `use:` action
// that drives this from keydown + the Gamepad API lives in `dpad-action.ts`.
// See ADR-0027 (custom focus-graph) + issue #71 (Gamepad-API input source).

/** A directional move on the focus graph. */
export type Direction = 'up' | 'down' | 'left' | 'right';

/** Axis-aligned bounding box in viewport coordinates (e.g. `getBoundingClientRect`). */
export interface FocusRect {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** A focus-graph candidate: an opaque id plus its current geometry. */
export interface FocusCandidate {
	readonly id: string;
	readonly rect: FocusRect;
}

interface Point {
	readonly x: number;
	readonly y: number;
}

function center(rect: FocusRect): Point {
	return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

/**
 * Whether `to` lies in `direction` relative to `from`, judged by centre
 * displacement on the dominant axis. Ties (pure diagonals) resolve to the
 * vertical axis owning `up`/`down` and the horizontal axis owning
 * `left`/`right`, so a candidate is never claimed by two perpendicular
 * directions.
 */
function isInDirection(from: Point, to: Point, direction: Direction): boolean {
	const dx = to.x - from.x;
	const dy = to.y - from.y;

	switch (direction) {
		case 'up':
			return dy < 0 && Math.abs(dy) >= Math.abs(dx);
		case 'down':
			return dy > 0 && Math.abs(dy) >= Math.abs(dx);
		case 'left':
			return dx < 0 && Math.abs(dx) > Math.abs(dy);
		case 'right':
			return dx > 0 && Math.abs(dx) > Math.abs(dy);
	}
}

/**
 * Cost of moving `from` → `to` in `direction`. Lower is better. Primary term is
 * displacement along the travel axis; off-axis drift is penalised so the
 * nearest well-aligned neighbour wins over a closer-but-skewed one.
 */
function directionalCost(from: Point, to: Point, direction: Direction): number {
	const dx = to.x - from.x;
	const dy = to.y - from.y;

	const [along, across] =
		direction === 'left' || direction === 'right'
			? [Math.abs(dx), Math.abs(dy)]
			: [Math.abs(dy), Math.abs(dx)];

	// Off-axis drift is weighted heavier than on-axis travel: a small lateral
	// slip should lose to a candidate squarely in the direction of travel.
	return along + across * 2;
}

/**
 * Choose the best focus target when moving `direction` from `current`.
 *
 * Returns the id of the geometrically nearest candidate that lies in the given
 * direction, or `null` when the graph has no neighbour that way (callers should
 * keep focus where it is — fail loud, don't wrap silently). The `current`
 * candidate itself is ignored even if present in `candidates`.
 */
export function computeNextFocus(
	current: FocusCandidate,
	direction: Direction,
	candidates: readonly FocusCandidate[],
): string | null {
	const origin = center(current.rect);
	let bestId: string | null = null;
	let bestCost = Number.POSITIVE_INFINITY;

	for (const candidate of candidates) {
		if (candidate.id === current.id) continue;
		const target = center(candidate.rect);
		if (!isInDirection(origin, target, direction)) continue;

		const cost = directionalCost(origin, target, direction);
		if (cost < bestCost) {
			bestCost = cost;
			bestId = candidate.id;
		}
	}

	return bestId;
}

/** Map a `KeyboardEvent.key` to a {@link Direction}, or `null` if unrelated. */
export function directionFromKey(key: string): Direction | null {
	switch (key) {
		case 'ArrowUp':
			return 'up';
		case 'ArrowDown':
			return 'down';
		case 'ArrowLeft':
			return 'left';
		case 'ArrowRight':
			return 'right';
		default:
			return null;
	}
}

/**
 * Standard-gamepad button → {@link Direction}, per the W3C Gamepad "standard"
 * mapping (buttons 12–15 are the D-pad). Returns `null` for non-D-pad buttons.
 */
export function directionFromGamepadButton(buttonIndex: number): Direction | null {
	switch (buttonIndex) {
		case 12:
			return 'up';
		case 13:
			return 'down';
		case 14:
			return 'left';
		case 15:
			return 'right';
		default:
			return null;
	}
}

/**
 * Left analog stick → {@link Direction} once it crosses `deadzone`. Picks the
 * dominant axis so a slightly-off push still reads as a clean cardinal move.
 * Returns `null` inside the deadzone.
 */
export function directionFromAxes(
	axisX: number,
	axisY: number,
	deadzone = 0.5,
): Direction | null {
	if (Math.abs(axisX) < deadzone && Math.abs(axisY) < deadzone) return null;
	if (Math.abs(axisX) >= Math.abs(axisY)) {
		return axisX < 0 ? 'left' : 'right';
	}
	return axisY < 0 ? 'up' : 'down';
}

/** A live view of the focus graph the navigation engine reads each event. */
export interface FocusGraphSource {
	/** Current focus-graph candidates (re-read per event so geometry stays live). */
	readonly candidates: () => readonly FocusCandidate[];
	/** Id of the currently-focused cell, or `null` if focus is outside the graph. */
	readonly current: () => string | null;
}

/**
 * Resolve the next focus id for a move, reading live state from `source`.
 * Returns `null` when focus is outside the graph, the current cell is unknown,
 * or there is no neighbour in `direction`. Pure given the source callbacks.
 */
export function resolveNextFocus(
	source: FocusGraphSource,
	direction: Direction,
): string | null {
	const currentId = source.current();
	if (currentId === null) return null;
	const candidates = source.candidates();
	const currentCandidate = candidates.find((c) => c.id === currentId);
	if (currentCandidate === undefined) return null;
	return computeNextFocus(currentCandidate, direction, candidates);
}
