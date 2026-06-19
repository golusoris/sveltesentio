import type { Rule } from 'eslint';

/**
 * Flat-config ESLint plugin bundling sveltesentio's two cross-package
 * invariants:
 *
 * - `no-direct-time` — time must flow through the injected {@link Clock}
 *   (`useClock` / `getClock` from `@sveltesentio/core`) so it is deterministic
 *   and testable (AGENTS.md §Invariants + docs/principles.md §2.1). Banned forms:
 *   `Date.now()`, zero-argument `new Date()`, `performance.now()`.
 * - `chart-a11y-wrapper` — every chart visual rendered from `layerchart` /
 *   `uplot` must go through `@sveltesentio/charts`' `<ChartFigure>` so the WCAG
 *   2.2 SC 1.1.1 text alternative cannot be skipped (charts/AGENTS.md §Invariants,
 *   ADR-0013). A bare `<LineChart>` / `<Chart>` / uPlot element with no
 *   `<ChartFigure>` ancestor is an error.
 *
 * Register in a flat `eslint.config.js`:
 *
 * ```js
 * import sentio from '@sveltesentio/core/eslint';
 * export default [
 *   {
 *     files: ['src/**\/*.ts'],
 *     plugins: { '@sveltesentio': sentio },
 *     rules: { '@sveltesentio/no-direct-time': 'error' },
 *   },
 *   {
 *     files: ['src/**\/*.svelte'],
 *     plugins: { '@sveltesentio': sentio },
 *     rules: { '@sveltesentio/chart-a11y-wrapper': 'error' },
 *   },
 * ];
 * ```
 */

// Pull the concrete AST node shapes from ESLint's own `Rule.Node` union so we
// don't take a direct dependency on `@types/estree` (ESLint owns that peer).
type Node = Rule.Node;
type CallExpressionNode = Extract<Node, { type: 'CallExpression' }>;
type NewExpressionNode = Extract<Node, { type: 'NewExpression' }>;
type ImportDeclarationNode = Extract<Node, { type: 'ImportDeclaration' }>;
type Callee = CallExpressionNode['callee'];

const CLOCK_HINT =
	'route time through the injected Clock — `useClock()`/`getClock()` ' +
	'(or `testClock` in tests) from @sveltesentio/core — so it stays ' +
	'deterministic and testable';

/** Matches `<object>.<property>` where both are plain (non-computed) identifiers. */
function isMemberCall(
	callee: Callee,
	objectName: string,
	propertyName: string,
): boolean {
	if (callee.type !== 'MemberExpression') return false;
	if (callee.computed) return false;
	if (callee.property.type !== 'Identifier') return false;
	if (callee.property.name !== propertyName) return false;
	return (
		callee.object.type === 'Identifier' && callee.object.name === objectName
	);
}

const noDirectTime: Rule.RuleModule = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'disallow direct wall-clock / monotonic time reads; use the injected Clock',
			recommended: true,
		},
		schema: [],
		messages: {
			dateNow: `Avoid \`Date.now()\` — ${CLOCK_HINT}.`,
			newDate: `Avoid argument-less \`new Date()\` — ${CLOCK_HINT}.`,
			performanceNow: `Avoid \`performance.now()\` — ${CLOCK_HINT}.`,
		},
	},

	create(context: Rule.RuleContext): Rule.RuleListener {
		return {
			CallExpression(node: CallExpressionNode): void {
				if (isMemberCall(node.callee, 'Date', 'now')) {
					context.report({ node, messageId: 'dateNow' });
					return;
				}
				if (isMemberCall(node.callee, 'performance', 'now')) {
					context.report({ node, messageId: 'performanceNow' });
				}
			},

			NewExpression(node: NewExpressionNode): void {
				if (node.callee.type !== 'Identifier') return;
				if (node.callee.name !== 'Date') return;
				// `new Date(serverMs)` is an explicit, deterministic construction —
				// only the zero-argument form reads ambient wall-clock time.
				if (node.arguments.length === 0) {
					context.report({ node, messageId: 'newDate' });
				}
			},
		};
	},
};

// --- chart-a11y-wrapper ------------------------------------------------------

const CHART_LIBS = ['layerchart', 'uplot'] as const;

/** The a11y wrappers from `@sveltesentio/charts` that satisfy the invariant. */
const A11Y_WRAPPER_ELEMENTS = new Set(['ChartFigure']);

const CHART_HINT =
	'render it inside `<ChartFigure>` from @sveltesentio/charts so the chart ' +
	'ships the required visually-hidden data table (WCAG 2.2 SC 1.1.1, ADR-0013)';

/**
 * Structural read of a `svelte-eslint-parser` `SvelteElement` name without
 * depending on the parser's types: a component element exposes
 * `name: { type: 'Identifier' | 'SvelteName', name: string }`. Anything else
 * (HTML tags, member-expression names) is not a chart-library binding and is
 * intentionally ignored.
 */
function svelteElementName(node: unknown): string | undefined {
	if (typeof node !== 'object' || node === null) return undefined;
	const name = (node as { name?: unknown }).name;
	if (typeof name !== 'object' || name === null) return undefined;
	const raw = (name as { name?: unknown }).name;
	return typeof raw === 'string' ? raw : undefined;
}

/** Reads the source string of a (validated) `ImportDeclaration`. */
function importSource(node: ImportDeclarationNode): string {
	const value = node.source.value;
	return typeof value === 'string' ? value : '';
}

/** True for `layerchart`, `layerchart/...`, `uplot`, `uplot/...`. */
function isChartLibSource(source: string): boolean {
	return CHART_LIBS.some(
		(lib) => source === lib || source.startsWith(`${lib}/`),
	);
}

const chartA11yWrapper: Rule.RuleModule = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'require chart visuals from layerchart / uplot to be wrapped in <ChartFigure>',
			recommended: true,
		},
		schema: [],
		messages: {
			bareChart: `Bare \`<{{name}}>\` from \`{{source}}\` bypasses the a11y wrapper — ${CHART_HINT}.`,
		},
	},

	create(context: Rule.RuleContext): Rule.RuleListener {
		// Local binding names imported from a chart library → the source they
		// came from, so the message can name it.
		const chartBindings = new Map<string, string>();

		return {
			ImportDeclaration(node: ImportDeclarationNode): void {
				const source = importSource(node);
				if (!isChartLibSource(source)) return;
				for (const spec of node.specifiers) {
					chartBindings.set(spec.local.name, source);
				}
			},

			// `SvelteElement` is the svelte-eslint-parser node for any element;
			// not part of ESLint's core `NodeListener`, so it rides the
			// RuleListener index signature.
			SvelteElement(node: Rule.Node): void {
				const name = svelteElementName(node);
				if (name === undefined) return;
				const source = chartBindings.get(name);
				if (source === undefined) return;
				// Allowed when nested under a sanctioned a11y wrapper element.
				const ancestors = context.sourceCode.getAncestors(node);
				const wrapped = ancestors.some((ancestor) =>
					A11Y_WRAPPER_ELEMENTS.has(svelteElementName(ancestor) ?? ''),
				);
				if (wrapped) return;
				context.report({
					node,
					messageId: 'bareChart',
					data: { name, source },
				});
			},
		};
	},
};

/** The flat-config plugin object (`plugins: { '@sveltesentio': sentioEslint }`). */
const sentioEslint = {
	meta: { name: '@sveltesentio/core', version: '0.2.0' },
	rules: {
		'no-direct-time': noDirectTime,
		'chart-a11y-wrapper': chartA11yWrapper,
	},
} satisfies {
	meta: { name: string; version: string };
	rules: Record<string, Rule.RuleModule>;
};

export { noDirectTime, chartA11yWrapper, sentioEslint };
export default sentioEslint;
