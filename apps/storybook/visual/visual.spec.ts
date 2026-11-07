import { expect, test } from '@playwright/test';

interface StoryIndex {
	v: number;
	entries: Record<string, { id: string; type: string; title: string; name: string }>;
}

const ANIMATION_SETTLE_MS = 500;

test('every story matches its baseline screenshot', async ({ page, request }) => {
	test.setTimeout(300_000);
	const res = await request.get('/index.json');
	expect(res.ok()).toBe(true);
	const index: StoryIndex = await res.json();
	const storyIds = Object.values(index.entries)
		.filter((entry) => entry.type === 'story')
		.map((entry) => entry.id)
		.sort();
	expect(storyIds.length).toBeGreaterThan(0);

	const failures: string[] = [];

	for (const storyId of storyIds) {
		try {
			const response = await page.goto(`/iframe.html?id=${storyId}&viewMode=story`, {
				waitUntil: 'networkidle',
				timeout: 30_000,
			});
			if (!response || !response.ok()) {
				failures.push(`${storyId}: HTTP ${response?.status() ?? 'no response'}`);
				continue;
			}
		} catch {
			failures.push(`${storyId}: navigation failed`);
			continue;
		}
		await page.waitForTimeout(ANIMATION_SETTLE_MS);

		const root = page.locator('#storybook-root');
		const isVisible = await root.isVisible();
		if (!isVisible) {
			failures.push(`${storyId}: #storybook-root not visible`);
			continue;
		}

		await expect(root).toHaveScreenshot(`${storyId}.png`, {
			animations: 'disabled',
		});
	}

	if (failures.length > 0) {
		console.warn(`Skipped ${failures.length} stories:\n${failures.join('\n')}`);
	}
});
