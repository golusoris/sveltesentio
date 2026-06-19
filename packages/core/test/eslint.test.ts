import { RuleTester } from 'eslint';
import * as svelteParser from 'svelte-eslint-parser';
import { describe, expect, it } from 'vitest';
import { chartA11yWrapper, noDirectTime, sentioEslint } from '../src/eslint';

const ruleTester = new RuleTester({
	languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

// `.svelte` fixtures need the svelte parser; everything else mirrors the JS rig.
const svelteRuleTester = new RuleTester({
	languageOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
		parser: svelteParser,
	},
});

describe('no-direct-time rule', () => {
	it('passes valid + flags invalid time reads', () => {
		ruleTester.run('no-direct-time', noDirectTime, {
			valid: [
				// the sanctioned path: read via the injected clock
				{ code: 'const now = useClock().now();' },
				{ code: 'const t = getClock().monotonic();' },
				// explicit, deterministic construction is allowed
				{ code: 'const d = new Date(serverMs);' },
				{ code: 'const d = new Date(2026, 0, 1);' },
				// unrelated `.now` / `.then` calls must not trip the rule
				{ code: 'foo.now();' },
				{ code: 'Date.parse("2026-01-01");' },
				{ code: 'performance.mark("x");' },
				// computed access is not the banned static form
				{ code: 'Date["now"]();' },
				// `new` of something other than `Date`, and via a non-identifier callee
				{ code: 'const m = new Map();' },
				{ code: 'const x = new foo.Bar();' },
			],
			invalid: [
				{
					code: 'const t = Date.now();',
					errors: [{ messageId: 'dateNow' }],
				},
				{
					code: 'const d = new Date();',
					errors: [{ messageId: 'newDate' }],
				},
				{
					code: 'const m = performance.now();',
					errors: [{ messageId: 'performanceNow' }],
				},
				{
					code: 'const a = Date.now(); const b = new Date();',
					errors: [{ messageId: 'dateNow' }, { messageId: 'newDate' }],
				},
			],
		});
	});

	it('exposes a flat-config plugin shape', () => {
		expect(sentioEslint.meta.name).toBe('@sveltesentio/core');
		expect(sentioEslint.rules['no-direct-time']).toBe(noDirectTime);
		expect(sentioEslint.rules['chart-a11y-wrapper']).toBe(chartA11yWrapper);
		expect(noDirectTime.meta?.messages).toMatchObject({
			dateNow: expect.any(String),
			newDate: expect.any(String),
			performanceNow: expect.any(String),
		});
	});
});

describe('chart-a11y-wrapper rule', () => {
	it('allows chart libs wrapped in <ChartFigure> + flags bare render', () => {
		svelteRuleTester.run('chart-a11y-wrapper', chartA11yWrapper, {
			valid: [
				// the sanctioned wrapper path — layerchart inside <ChartFigure>
				{
					filename: 'LineChart.svelte',
					code: `<script>
  import { LineChart as LcLineChart } from 'layerchart';
  import ChartFigure from './ChartFigure.svelte';
</script>
<ChartFigure title="x">
  {#snippet chart()}
    <LcLineChart x={1} />
  {/snippet}
</ChartFigure>`,
				},
				// uPlot wrapped — deeper nesting still counts the ancestor
				{
					filename: 'UPlot.svelte',
					code: `<script>
  import UPlot from 'uplot';
  import ChartFigure from './ChartFigure.svelte';
</script>
<ChartFigure title="y">
  {#snippet chart()}
    <div><UPlot /></div>
  {/snippet}
</ChartFigure>`,
				},
				// a layerchart subpath import, still wrapped
				{
					filename: 'Bar.svelte',
					code: `<script>
  import { Bar } from 'layerchart/marks';
  import ChartFigure from './ChartFigure.svelte';
</script>
<ChartFigure title="z"><Bar /></ChartFigure>`,
				},
				// no chart-lib import at all — unrelated components never trip
				{
					filename: 'Plain.svelte',
					code: `<script>
  import Button from './Button.svelte';
</script>
<Button>hi</Button>`,
				},
				// an element whose name collides with no chart binding
				{
					filename: 'Collide.svelte',
					code: `<script>
  import { LineChart } from 'layerchart';
  import ChartFigure from './ChartFigure.svelte';
</script>
<ChartFigure title="t"><LineChart /></ChartFigure>
<section><p>no chart here</p></section>`,
				},
			],
			invalid: [
				// bare layerchart element, no <ChartFigure> ancestor
				{
					filename: 'Bare.svelte',
					code: `<script>
  import { LineChart as LcLineChart } from 'layerchart';
</script>
<LcLineChart x={1} />`,
					errors: [
						{
							messageId: 'bareChart',
							data: { name: 'LcLineChart', source: 'layerchart' },
						},
					],
				},
				// bare default-imported uPlot element
				{
					filename: 'BareUPlot.svelte',
					code: `<script>
  import UPlot from 'uplot';
</script>
<div><UPlot /></div>`,
					errors: [
						{
							messageId: 'bareChart',
							data: { name: 'UPlot', source: 'uplot' },
						},
					],
				},
				// one wrapped + one bare in the same file → only the bare one trips
				{
					filename: 'Mixed.svelte',
					code: `<script>
  import { LineChart as L } from 'layerchart';
  import ChartFigure from './ChartFigure.svelte';
</script>
<ChartFigure title="x">{#snippet chart()}<L x={1} />{/snippet}</ChartFigure>
<L x={2} />`,
					errors: [
						{
							messageId: 'bareChart',
							data: { name: 'L', source: 'layerchart' },
						},
					],
				},
				// namespace import from a chart lib, used bare
				{
					filename: 'Ns.svelte',
					code: `<script>
  import * as LC from 'layerchart';
</script>
<LC x={1} />`,
					errors: [
						{
							messageId: 'bareChart',
							data: { name: 'LC', source: 'layerchart' },
						},
					],
				},
			],
		});
	});
});
