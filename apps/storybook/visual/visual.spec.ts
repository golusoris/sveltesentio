import { expect, test } from '@playwright/test';

interface StoryIndex {
	v: number;
	entries: Record<string, { id: string; type: string; title: string; name: string }>;
}

const ANIMATION_SETTLE_MS = 500;
const MAX_STORIES = 500;

test('every story matches its baseline screenshot', async ({ page, request }) => {
	test.setTimeout(300_000);
	const res = await request.get('/index.json', { timeout: 10_000 });
	expect(res.ok()).toBe(true);
	const index: StoryIndex = await res.json();
	const storyIds = Object.values(index.entries ?? {})
		.filter((entry) => entry.type === 'story')
		.map((entry) => entry.id)
		.sort();
	expect(storyIds.length).toBeGreaterThan(0);
	expect(storyIds.length).toBeLessThanOrEqual(MAX_STORIES);

	const errors: string[] = [];
	const skipped: string[] = [];

	for (const storyId of storyIds) {
		try {
			const response = await page.goto(`/iframe.html?id=${storyId}&viewMode=story`, {
				waitUntil: 'networkidle',
				timeout: 30_000,
			});
			if (!response?.ok()) {
				errors.push(`${storyId}: HTTP ${response?.status() ?? 'no response'}`);
				continue;
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`${storyId}: navigation failed (${msg})`);
			continue;
		}
		await page.waitForTimeout(ANIMATION_SETTLE_MS);

		const root = page.locator('#storybook-root');
		const isVisible = await root.isVisible();
		if (!isVisible) {
			skipped.push(`${storyId}: #storybook-root not visible`);
			continue;
		}

		await expect.soft(root).toHaveScreenshot(`${storyId}.png`, {
			animations: 'disabled',
		});
	}

	if (skipped.length > 0) {
		console.warn(`Skipped ${skipped.length} stories:\n${skipped.join('\n')}`);
	}
	expect(
		skipped,
		`${skipped.length} stories had invisible #storybook-root:\n${skipped.join('\n')}`,
	).toHaveLength(0);
	expect(errors, `${errors.length} stories failed to load:\n${errors.join('\n')}`).toHaveLength(0);
});
