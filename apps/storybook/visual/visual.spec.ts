import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

interface StoryIndex {
	v: number;
	entries: Record<string, { id: string; type: string; title: string; name: string }>;
}

const ANIMATION_SETTLE_MS = 500;
const MAX_STORIES = 500;

function isStoryIndex(body: unknown): body is StoryIndex {
	return (
		typeof body === 'object' &&
		body !== null &&
		'entries' in body &&
		typeof body.entries === 'object' &&
		body.entries !== null
	);
}

/** Sorted ids of every story in Storybook's index.json. */
async function listStoryIds(request: APIRequestContext): Promise<string[]> {
	const res = await request.get('/index.json', { timeout: 10_000 });
	expect(res.ok()).toBe(true);
	const body: unknown = await res.json();
	expect(isStoryIndex(body), 'index.json is not a Storybook story index').toBe(true);
	if (!isStoryIndex(body)) return [];
	return Object.values(body.entries)
		.filter((entry) => entry.type === 'story')
		.map((entry) => entry.id)
		.sort();
}

/** Opens one story; returns why it failed to load, or undefined when it loaded. */
async function openStory(page: Page, storyId: string): Promise<string | undefined> {
	try {
		const response = await page.goto(`/iframe.html?id=${storyId}&viewMode=story`, {
			waitUntil: 'networkidle',
			timeout: 30_000,
		});
		if (!response?.ok()) return `${storyId}: HTTP ${response?.status() ?? 'no response'}`;
		return undefined;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return `${storyId}: navigation failed (${msg})`;
	}
}

test('every story matches its baseline screenshot', async ({ page, request }) => {
	test.setTimeout(300_000);
	const storyIds = await listStoryIds(request);
	expect(storyIds.length).toBeGreaterThan(0);
	expect(storyIds.length).toBeLessThanOrEqual(MAX_STORIES);

	const errors: string[] = [];
	const skipped: string[] = [];

	for (const storyId of storyIds) {
		const loadError = await openStory(page, storyId);
		if (loadError !== undefined) {
			errors.push(loadError);
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
