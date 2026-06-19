// Minimal mount page that drives the REAL `@sveltesentio/shell` primitives in a
// real browser (Playwright/chromium). No Svelte component compilation is needed:
// `dpadNavigation` is a framework-agnostic `use:` action, so we invoke its
// returned lifecycle object directly against a hand-built focusable grid. This
// keeps the e2e harness independent of Playwright-CT-for-Svelte-5 support while
// still exercising the shipped action end-to-end (keydown + Gamepad API).

import { dpadNavigation } from '../../src/dpad-action.ts';
import type { FocusCandidate } from '../../src/dpad.ts';
import { classifyDevice, type DeviceClass } from '../../src/device-class.ts';
import { cssVarsString, safeAreaPadding } from '../../src/safe-area.ts';

/** Collect the live focus-graph candidates from the rendered grid. */
function readCandidates(): readonly FocusCandidate[] {
  const cells = document.querySelectorAll<HTMLElement>('[data-cell]');
  return Array.from(cells, (el) => {
    const rect = el.getBoundingClientRect();
    return {
      id: el.dataset.cell as string,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    };
  });
}

/** Id of the currently-focused cell, or `null` when focus sits outside the grid. */
function currentCellId(): string | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.dataset.cell !== undefined) {
    return active.dataset.cell;
  }
  return null;
}

/** Move DOM focus to the cell with `id`. */
function focusCell(id: string): void {
  const target = document.querySelector<HTMLElement>(`[data-cell="${id}"]`);
  target?.focus();
}

function mountGrid(root: HTMLElement): void {
  // A 3×3 roving-tabindex grid. Each cell is a real <button> so it is natively
  // focusable and visible to axe as an interactive control with an accessible
  // name. `data-cell` ids encode (row,col) so tests can assert spatial moves.
  const grid = document.createElement('div');
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', 'D-pad focus grid');
  grid.id = 'focus-grid';
  // Rows stack vertically; cells within a row run horizontally. This makes the
  // visual position match the `row-col` id (row 0 on top, col 0 on the left),
  // so directional moves can be asserted spatially.
  grid.style.display = 'flex';
  grid.style.flexDirection = 'column';
  grid.style.gap = '0.5rem';

  for (let row = 0; row < 3; row++) {
    const rowEl = document.createElement('div');
    rowEl.setAttribute('role', 'row');
    rowEl.style.display = 'flex';
    rowEl.style.flexDirection = 'row';
    rowEl.style.gap = '0.5rem';
    for (let col = 0; col < 3; col++) {
      const id = `${row}-${col}`;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.dataset.cell = id;
      cell.setAttribute('role', 'gridcell');
      // Roving tabindex: only the first cell is in the tab order.
      cell.tabIndex = row === 0 && col === 0 ? 0 : -1;
      cell.textContent = `Cell ${id}`;
      cell.style.width = '6rem';
      cell.style.height = '3rem';
      rowEl.appendChild(cell);
    }
    grid.appendChild(rowEl);
  }
  root.appendChild(grid);

  // Wire the SHIPPED action. It owns keydown + Gamepad-API polling; the page
  // only supplies the live graph view + a focus mover.
  const controller = dpadNavigation(grid, {
    candidates: readCandidates,
    current: currentCellId,
    focus: focusCell,
  });
  // Expose teardown for completeness (Playwright tears down the page anyway).
  (window as unknown as { __dpadDestroy?: () => void }).__dpadDestroy = () =>
    controller?.destroy?.();

  // Seed focus on the top-left cell so arrow navigation has an origin.
  focusCell('0-0');
}

function mountShellLayout(root: HTMLElement): void {
  // A representative device-class shell chrome for the axe sweep: landmark
  // regions, a heading, a nav, and safe-area logical padding (ADR-0029). The
  // device class is computed by the SHIPPED `classifyDevice`, proving the
  // interface-type path renders without a11y regressions.
  const deviceClass: DeviceClass = classifyDevice({
    pointerCoarse: false,
    viewportWidth: window.innerWidth,
  });

  const shell = document.createElement('div');
  shell.id = 'shell-root';
  shell.dataset.deviceClass = deviceClass;
  shell.style.cssText = cssVarsString({ top: '1rem', bottom: '1rem' });

  const header = document.createElement('header');
  header.style.cssText = safeAreaPadding('block-start');
  const h1 = document.createElement('h1');
  h1.textContent = 'sveltesentio shell';
  header.appendChild(h1);

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Primary');
  const ul = document.createElement('ul');
  ul.style.cssText = 'list-style:none;display:flex;gap:0.75rem;padding:0;margin:0';
  for (const label of ['Home', 'Library', 'Settings']) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${label.toLowerCase()}`;
    a.textContent = label;
    // WCAG 2.2 target-size (AA): ≥24×24px hit area with spacing.
    a.style.cssText =
      'display:inline-block;min-width:3rem;min-height:2.75rem;padding:0.75rem 1rem;line-height:1.25rem';
    li.appendChild(a);
    ul.appendChild(li);
  }
  nav.appendChild(ul);

  const main = document.createElement('main');
  main.style.cssText = safeAreaPadding('block-end');
  const h2 = document.createElement('h2');
  h2.textContent = 'Focusable grid';
  main.appendChild(h2);

  shell.append(header, nav, main);
  root.appendChild(shell);

  // The grid lives inside <main> so the sweep covers landmarks + interactive
  // controls together.
  mountGrid(main);
}

const app = document.getElementById('app');
if (app !== null) mountShellLayout(app);
