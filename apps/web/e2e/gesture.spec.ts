import { expect, test, type Page } from '@playwright/test';

/**
 * `4.C1` — draw a rectangle, drag it 200px, and prove two things at once: the drag was ONE
 * gesture with `opCount === 1`, and the painted pixels moved with it.
 *
 * Against the production build, on a fresh empty board, through real pointer events on the
 * overlay canvas. The gesture count is read from the page's bench sink — the store's own report
 * of what each gesture cost — and the pixels are read from the static canvas, which is the one
 * committed shapes are painted on. Both have to agree with the test's own arithmetic.
 */

const DRAG_PX = 200;
const BOARD = '/b/e2e-gesture?bench=1';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const gestures = (page: Page) => page.evaluate(() => window.__tessera?.gestures ?? []);

const onlyBox = async (page: Page): Promise<Box> => {
  const plan = await page.evaluate(() => window.__tessera?.plan() ?? []);
  expect(plan, 'exactly one shape on the board').toHaveLength(1);
  return plan[0]!.device;
};

/** True when the device pixel at the box's centre on the STATIC canvas is not background. */
const paintedAt = (page: Page, box: Box): Promise<boolean> =>
  page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board"]');
      const ctx = canvas?.getContext('2d');
      if (ctx === null || ctx === undefined) throw new Error('no static canvas');
      const [r, g, b, a] = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return (a ?? 0) > 0 && Math.min(r ?? 255, g ?? 255, b ?? 255) < 240;
    },
    { x: box.x + box.w / 2, y: box.y + box.h / 2 },
  );

const waitForGestures = (page: Page, count: number): Promise<unknown> =>
  page.waitForFunction((n) => (window.__tessera?.gestures.length ?? 0) >= n, count);

test.describe('gesture', () => {
  test('a rectangle is drawn, then dragged 200px in one gesture, and its pixels follow', async ({ page }) => {
    await page.goto(BOARD);
    const overlay = page.getByTestId('board-overlay');
    await overlay.waitFor();
    await page.waitForFunction(() => window.__tessera !== undefined);

    const bounds = await overlay.boundingBox();
    if (bounds === null) throw new Error('overlay has no bounding box');
    const origin = { x: bounds.x + 400, y: bounds.y + 300 };

    // Draw: rect tool, press, drag out a 120x80 box, release.
    await page.getByTestId('tool-rect').click();
    await expect(page.getByTestId('tool-rect')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + 120, origin.y + 80, { steps: 8 });
    await page.mouse.up();
    await waitForGestures(page, 1);

    const drawn = await gestures(page);
    expect(drawn[0]).toEqual({ committed: true, opCount: 1 });

    // The static canvas has to have painted the new shape before its box means anything.
    await page.waitForFunction(() => (window.__tessera?.plan().length ?? 0) === 1);
    await page.waitForFunction((n) => (window.__tessera?.frames.length ?? 0) > n, 0);
    const before = await onlyBox(page);
    expect(await paintedAt(page, before), 'pixel inside the drawn rectangle').toBe(true);

    // Move: select tool, grab the middle of the rectangle, drag 200px right across many frames.
    await page.getByTestId('tool-select').click();
    const grab = { x: origin.x + 60, y: origin.y + 40 };
    const framesBefore = await page.evaluate(() => window.__tessera?.frames.length ?? 0);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + DRAG_PX, grab.y, { steps: 40 });
    await page.mouse.up();
    await waitForGestures(page, 2);

    // ONE gesture, ONE write — forty pointer moves notwithstanding. This is the commit-on-pointerup
    // rule observed from outside the page rather than trusted.
    const all = await gestures(page);
    expect(all).toHaveLength(2);
    expect(all[1]).toEqual({ committed: true, opCount: 1 });

    // And the pixels moved by exactly the drag. The static layer repaints after the commit.
    await page.waitForFunction((n) => (window.__tessera?.frames.length ?? 0) > n, framesBefore);
    const after = await onlyBox(page);
    expect(after.x - before.x).toBeCloseTo(DRAG_PX, 3);
    expect(after.y - before.y).toBeCloseTo(0, 3);
    expect(await paintedAt(page, after), 'pixel inside the moved rectangle').toBe(true);
    expect(await paintedAt(page, before), 'pixel where it used to be').toBe(false);

    // Undo puts it back, on screen and in the store.
    await page.getByTestId('undo').click();
    await page.waitForFunction((x) => Math.abs((window.__tessera?.plan()[0]?.device.x ?? -1) - x) < 0.01, before.x);
    expect(await paintedAt(page, before), 'pixel back where it was after undo').toBe(true);
  });

  test('the ephemerality banner is visible on every board', async ({ page }) => {
    // 4.C4's headless half. The human row opens the live URL; this asserts the declared limit is
    // on the page at all, so a redesign cannot drop it silently.
    await page.goto(BOARD);
    await expect(page.getByTestId('ephemeral-banner')).toBeVisible();
    await expect(page.getByTestId('ephemeral-banner')).toContainText('ephemeral');
  });
});
