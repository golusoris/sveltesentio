// Safe-area inset helpers. Pure, framework-agnostic, CSS-only.
// Pairs with the Tailwind 4 `@utility` safe-area helpers from ADR-0029 and the
// `viewport-fit=cover` meta tag that makes `env(safe-area-inset-*)` resolve.

/** The four physical safe-area edges (notch / overscan / gesture bars). */
export type SafeAreaSide = 'top' | 'right' | 'bottom' | 'left';

/** Logical (writing-mode-aware) inset edges, for RTL-safe composition. */
export type SafeAreaLogicalEdge = 'block-start' | 'block-end' | 'inline-start' | 'inline-end';

export const SAFE_AREA_SIDES: readonly SafeAreaSide[] = ['top', 'right', 'bottom', 'left'];

/**
 * The CSS `env()` expression for one safe-area inset, optionally floored at a
 * fallback length so a zero inset still leaves breathing room.
 *
 * @example safeAreaInset('top') // "env(safe-area-inset-top)"
 * @example safeAreaInset('top', '1rem') // "max(env(safe-area-inset-top), 1rem)"
 */
export function safeAreaInset(side: SafeAreaSide, fallback?: string): string {
	const env = `env(safe-area-inset-${side})`;
	return fallback === undefined ? env : `max(${env}, ${fallback})`;
}

/** Map a logical edge to its physical side under a left-to-right base direction. */
const LTR_LOGICAL_TO_PHYSICAL: Record<SafeAreaLogicalEdge, SafeAreaSide> = {
	'block-start': 'top',
	'block-end': 'bottom',
	'inline-start': 'left',
	'inline-end': 'right',
};

/**
 * The CSS custom-property name sveltesentio emits for a side, e.g.
 * `--ss-safe-top`. Consumers read these via `var(--ss-safe-top)` so the inset
 * source lives in one place.
 */
export function safeAreaVarName(side: SafeAreaSide): `--ss-safe-${SafeAreaSide}` {
	return `--ss-safe-${side}`;
}

/**
 * Emit the safe-area custom properties as a `name → value` record, suitable for
 * spreading into an inline `style` object or serialising with
 * {@link cssVarsString}. Pass per-side fallbacks to floor specific edges (handy
 * for TV overscan, which has no `env()` value on most platforms).
 *
 * @example
 * cssVars({ top: '2dvh' })
 * // → { '--ss-safe-top': 'max(env(safe-area-inset-top), 2dvh)', '--ss-safe-right': 'env(safe-area-inset-right)', … }
 */
export function cssVars(
	fallbacks: Partial<Record<SafeAreaSide, string>> = {},
): Record<`--ss-safe-${SafeAreaSide}`, string> {
	const out = {} as Record<`--ss-safe-${SafeAreaSide}`, string>;
	for (const side of SAFE_AREA_SIDES) {
		out[safeAreaVarName(side)] = safeAreaInset(side, fallbacks[side]);
	}
	return out;
}

/**
 * Serialise the output of {@link cssVars} into a `style`-attribute string:
 * `--ss-safe-top:env(safe-area-inset-top);…`.
 */
export function cssVarsString(fallbacks: Partial<Record<SafeAreaSide, string>> = {}): string {
	const vars = cssVars(fallbacks);
	return Object.entries(vars)
		.map(([name, value]) => `${name}:${value}`)
		.join(';');
}

/**
 * The logical-property declaration for an edge, e.g.
 * `padding-block-start: var(--ss-safe-top)`. Logical so it cooperates with RTL
 * writing modes per the package's "no physical-dimension CSS" invariant.
 */
export function safeAreaPadding(edge: SafeAreaLogicalEdge): string {
	const side = LTR_LOGICAL_TO_PHYSICAL[edge];
	return `padding-${edge}: var(${safeAreaVarName(side)})`;
}
