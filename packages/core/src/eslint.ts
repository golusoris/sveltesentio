import type { Rule } from 'eslint';

/**
 * Flat-config ESLint plugin enforcing the core "no direct time reads" invariant
 * (see AGENTS.md §Invariants + docs/principles.md §2.1): time must flow through
 * the injected {@link Clock} (`useClock` / `getClock` from `@sveltesentio/core`)
 * so it is deterministic and testable. Banned forms:
 *
 * - `Date.now()`
 * - `new Date()` (zero-argument — `new Date(serverMs)` is explicit + allowed)
 * - `performance.now()`
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
 * ];
 * ```
 */

// Pull the concrete AST node shapes from ESLint's own `Rule.Node` union so we
// don't take a direct dependency on `@types/estree` (ESLint owns that peer).
type Node = Rule.Node;
type CallExpressionNode = Extract<Node, { type: 'CallExpression' }>;
type NewExpressionNode = Extract<Node, { type: 'NewExpression' }>;
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

/** The flat-config plugin object (`plugins: { '@sveltesentio': sentioEslint }`). */
const sentioEslint = {
	meta: { name: '@sveltesentio/core', version: '0.1.0' },
	rules: {
		'no-direct-time': noDirectTime,
	},
} satisfies {
	meta: { name: string; version: string };
	rules: Record<string, Rule.RuleModule>;
};

export { noDirectTime, sentioEslint };
export default sentioEslint;
