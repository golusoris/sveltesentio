import { test, expect, type Page } from '@playwright/test';

// Arrow-key + gamepad roving-focus navigation through the sample focusable grid,
// driving the SHIPPED `dpadNavigation` action in a real chromium browser.
// The harness mounts a 3×3 grid of <button> cells with `data-cell="row-col"`;
// the action reads live geometry per event, so these moves exercise the real
// nearest-neighbour focus graph (ADR-0027), not a mock.

/** The id of the cell that currently holds DOM focus, e.g. "1-2". */
async function focusedCell(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement ? (active.dataset.cell ?? null) : null;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // The harness seeds focus on the top-left cell.
  await expect.poll(() => focusedCell(page)).toBe('0-0');
});

test.describe('arrow-key roving focus', () => {
  test('ArrowRight / ArrowDown walk the grid one cell per press', async ({ page }) => {
    const grid = page.locator('#focus-grid');
    await grid.press('ArrowRight');
    expect(await focusedCell(page)).toBe('0-1');

    await page.locator('[data-cell="0-1"]').press('ArrowRight');
    expect(await focusedCell(page)).toBe('0-2');

    await page.locator('[data-cell="0-2"]').press('ArrowDown');
    expect(await focusedCell(page)).toBe('1-2');

    await page.locator('[data-cell="1-2"]').press('ArrowDown');
    expect(await focusedCell(page)).toBe('2-2');
  });

  test('ArrowLeft / ArrowUp reverse the walk back to the origin', async ({ page }) => {
    // Drive into the bottom-right corner first.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect(await focusedCell(page)).toBe('2-2');

    await page.keyboard.press('ArrowLeft');
    expect(await focusedCell(page)).toBe('2-1');
    await page.keyboard.press('ArrowUp');
    expect(await focusedCell(page)).toBe('1-1');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    expect(await focusedCell(page)).toBe('0-0');
  });

  test('moving past the grid edge keeps focus put (fail loud, no wrap)', async ({ page }) => {
    // Top-left corner: up and left have no neighbour.
    await page.keyboard.press('ArrowUp');
    expect(await focusedCell(page)).toBe('0-0');
    await page.keyboard.press('ArrowLeft');
    expect(await focusedCell(page)).toBe('0-0');
  });

  test('a non-arrow key does not move focus', async ({ page }) => {
    await page.keyboard.press('Enter');
    expect(await focusedCell(page)).toBe('0-0');
  });
});

test.describe('gamepad D-pad roving focus', () => {
  // The Gamepad API has no synthetic-input driver in headless chromium, so we
  // override `navigator.getGamepads` before any script runs (per shell/AGENTS.md
  // "D-pad accepts both input sources"). The action's real rAF poll loop then
  // reads our fake pad and edge-triggers one focus move per fresh press — the
  // genuine shipped gamepad path, not a keyboard stand-in.
  async function installFakeGamepad(page: Page): Promise<void> {
    await page.addInitScript(() => {
      interface MutableButton {
        pressed: boolean;
        touched: boolean;
        value: number;
      }
      const buttons: MutableButton[] = Array.from({ length: 16 }, () => ({
        pressed: false,
        touched: false,
        value: 0,
      }));
      const pad = {
        id: 'sveltesentio-fake-pad (standard)',
        index: 0,
        connected: true,
        mapping: 'standard' as const,
        timestamp: 0,
        axes: [0, 0, 0, 0],
        buttons,
        vibrationActuator: null,
      };
      const w = window as unknown as {
        navigator: Navigator;
        __pressPad?: (index: number) => void;
        __releasePad?: (index: number) => void;
      };
      Object.defineProperty(w.navigator, 'getGamepads', {
        configurable: true,
        value: () => [pad as unknown as Gamepad, null, null, null],
      });
      const setPressed = (index: number, pressed: boolean): void => {
        const button = buttons[index];
        if (button === undefined) return;
        button.pressed = pressed;
        button.value = pressed ? 1 : 0;
        pad.timestamp = performance.now();
      };
      w.__pressPad = (index: number) => setPressed(index, true);
      w.__releasePad = (index: number) => setPressed(index, false);
    });
  }

  /**
   * Press a standard D-pad button, hold it until focus reaches `expected`
   * (the action edge-triggers one move on the fresh press), then release.
   * Holding until the move is observed — rather than a fixed timeout — makes
   * the tap deterministic against the rAF poll loop's timing in headless
   * chromium. Releasing before the next tap is what arms the next edge.
   */
  async function tapPad(page: Page, buttonIndex: number, expected: string): Promise<void> {
    await page.evaluate((i) => {
      (window as unknown as { __pressPad: (n: number) => void }).__pressPad(i);
    }, buttonIndex);
    await expect.poll(() => focusedCell(page)).toBe(expected);
    await page.evaluate((i) => {
      (window as unknown as { __releasePad: (n: number) => void }).__releasePad(i);
    }, buttonIndex);
    // Let the loop observe the release so `pressed` clears before the next tap.
    await page.waitForTimeout(50);
  }

  test.beforeEach(async ({ page }) => {
    await installFakeGamepad(page);
    await page.goto('/');
    await expect.poll(() => focusedCell(page)).toBe('0-0');
    // Focus the grid so subsequent visual focus moves land on grid cells.
    await page.locator('[data-cell="0-0"]').focus();
  });

  // Standard mapping: 12=up, 13=down, 14=left, 15=right.
  test('D-pad right/down buttons move focus across the grid', async ({ page }) => {
    await tapPad(page, 15, '0-1'); // right
    await tapPad(page, 13, '1-1'); // down
    await tapPad(page, 15, '1-2'); // right
    expect(await focusedCell(page)).toBe('1-2');
  });

  test('D-pad left/up buttons reverse the walk', async ({ page }) => {
    await tapPad(page, 15, '0-1'); // right → 0-1
    await tapPad(page, 13, '1-1'); // down  → 1-1
    await tapPad(page, 14, '1-0'); // left  → 1-0
    await tapPad(page, 12, '0-0'); // up    → 0-0
    expect(await focusedCell(page)).toBe('0-0');
  });

  test('holding a D-pad button moves exactly one cell (no hold-repeat)', async ({ page }) => {
    // Press and keep held across several poll frames.
    await page.evaluate(() => {
      (window as unknown as { __pressPad: (n: number) => void }).__pressPad(15);
    });
    await page.waitForTimeout(200); // many rAF frames
    await expect.poll(() => focusedCell(page)).toBe('0-1');
    // Still held — must not have advanced to 0-2.
    expect(await focusedCell(page)).toBe('0-1');
    await page.evaluate(() => {
      (window as unknown as { __releasePad: (n: number) => void }).__releasePad(15);
    });
  });
});
