import { test, expect, type Page } from '@playwright/test';

// Keyboard-shortcut playback, driving the SHIPPED `@sveltesentio/media` headless
// helpers (`actionForKey` + `playbackReducer` + `clampVolume` + `formatMediaTime`)
// in real chromium via real key events. The harness mounts a focusable `<video>`
// and mirrors authoritative state onto `#player-root` `data-*`; these specs
// assert the Vidstack-parity keyboard map (ADR-0042), not a mock.

const ROOT = '#player-root';

/** Press a key while the player has focus. */
async function press(page: Page, key: string): Promise<void> {
  await page.locator('#player').press(key);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Harness seeds load→ready, so the player starts paused (not idle).
  await expect(page.locator(ROOT)).toHaveAttribute('data-status', 'paused');
  await page.locator('#player').focus();
});

test.describe('play / pause toggle', () => {
  test('Space toggles play and pause', async ({ page }) => {
    await press(page, 'Space');
    await expect(page.locator(ROOT)).toHaveAttribute('data-status', 'playing');
    await press(page, 'Space');
    await expect(page.locator(ROOT)).toHaveAttribute('data-status', 'paused');
  });

  test('K is an alias for Space (Vidstack parity)', async ({ page }) => {
    await press(page, 'k');
    await expect(page.locator(ROOT)).toHaveAttribute('data-status', 'playing');
    await press(page, 'k');
    await expect(page.locator(ROOT)).toHaveAttribute('data-status', 'paused');
  });

  test('a held modifier is never hijacked (Ctrl+Space is a no-op)', async ({ page }) => {
    await page.locator('#player').press('Control+Space');
    await expect(page.locator(ROOT)).toHaveAttribute('data-status', 'paused');
  });

  test('an unmapped key does nothing', async ({ page }) => {
    await press(page, 'Enter');
    await expect(page.locator(ROOT)).toHaveAttribute('data-status', 'paused');
  });
});

test.describe('seek', () => {
  test('ArrowRight / ArrowLeft step the play-head by 10s', async ({ page }) => {
    await press(page, 'ArrowRight');
    await expect(page.locator(ROOT)).toHaveAttribute('data-time', '10');
    await press(page, 'ArrowRight');
    await expect(page.locator(ROOT)).toHaveAttribute('data-time', '20');
    await press(page, 'ArrowLeft');
    await expect(page.locator(ROOT)).toHaveAttribute('data-time', '10');
  });

  test('seeking before the start clamps to 0', async ({ page }) => {
    await press(page, 'ArrowLeft');
    await expect(page.locator(ROOT)).toHaveAttribute('data-time', '0');
  });

  test('the visible time-code formats via formatMediaTime', async ({ page }) => {
    for (let i = 0; i < 7; i++) await press(page, 'ArrowRight'); // 70s
    await expect(page.locator('#timecode')).toHaveText('1:10');
  });
});

test.describe('volume + mute', () => {
  test('ArrowUp / ArrowDown step volume by 0.1', async ({ page }) => {
    await expect(page.locator(ROOT)).toHaveAttribute('data-volume', '0.50');
    await press(page, 'ArrowUp');
    await expect(page.locator(ROOT)).toHaveAttribute('data-volume', '0.60');
    await press(page, 'ArrowDown');
    await expect(page.locator(ROOT)).toHaveAttribute('data-volume', '0.50');
  });

  test('volume clamps to [0, 1]', async ({ page }) => {
    for (let i = 0; i < 8; i++) await press(page, 'ArrowUp');
    await expect(page.locator(ROOT)).toHaveAttribute('data-volume', '1.00');
    for (let i = 0; i < 14; i++) await press(page, 'ArrowDown');
    await expect(page.locator(ROOT)).toHaveAttribute('data-volume', '0.00');
  });

  test('M toggles mute', async ({ page }) => {
    await press(page, 'm');
    await expect(page.locator(ROOT)).toHaveAttribute('data-muted', 'true');
    await press(page, 'm');
    await expect(page.locator(ROOT)).toHaveAttribute('data-muted', 'false');
  });
});

test.describe('captions + fullscreen', () => {
  test('C toggles captions', async ({ page }) => {
    await press(page, 'c');
    await expect(page.locator(ROOT)).toHaveAttribute('data-captions', 'true');
    await press(page, 'c');
    await expect(page.locator(ROOT)).toHaveAttribute('data-captions', 'false');
  });

  test('F toggles the fullscreen intent', async ({ page }) => {
    await press(page, 'f');
    await expect(page.locator(ROOT)).toHaveAttribute('data-fullscreen', 'true');
    await press(page, 'f');
    await expect(page.locator(ROOT)).toHaveAttribute('data-fullscreen', 'false');
  });
});
