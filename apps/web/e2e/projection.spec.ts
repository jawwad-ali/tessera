import { expect, test, type Page } from '@playwright/test';

/**
 * `3.C1` — a pixel is proven painted in the right place.
 *
 * Two assertions, in a real browser, against the production build:
 *
 *  (i)  a non-background pixel exists inside a known fixture shape's projected box, and
 *  (ii) after a programmatic 200px drag, the box has moved by exactly 200px, non-background
 *       pixels appear inside the new box, and the old box is background again.
 *
 * The page's own draw plan (exposed under `?bench=1`) says where the renderer *believes* each
 * shape is. The canvas readback says where paint actually *landed*. The test is the agreement
 * between the two, plus the arithmetic that a 200px drag moves the plan by 200px — which is
 * computed here, not asked of the page.
 */

const DRAG_PX = 200;
/** Two shapes far apart: small on screen at zoom-to-fit, so a 200px drag clears the old box. */
const BOARD = '/b/demo?seed=1&n=2&bench=1';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The renderer's own account of where `id` is, in device pixels. */
const boxOf = async (page: Page, id: string): Promise<Box> => {
  const box = await page.evaluate((wanted) => {
    const found = window.__tessera?.plan().find((item) => item.id === wanted);
    return found === undefined ? undefined : found.device;
  }, id);
  expect(box, `${id} is in the draw plan`).toBeDefined();
  return box as Box;
};

/** True when the device pixel at the box's centre is not the white background. */
const paintedAt = async (page: Page, box: Box): Promise<boolean> =>
  page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board"]');
      const ctx = canvas?.getContext('2d');
      if (ctx === null || ctx === undefined) throw new Error('no canvas');
      const [r, g, b, a] = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      // White background is (255,255,255,255) and an unpainted canvas is (0,0,0,0). Either way,
      // a fixture colour has a channel well below 240 with full alpha.
      return (a ?? 0) > 0 && Math.min(r ?? 255, g ?? 255, b ?? 255) < 240;
    },
    { x: box.x + box.w / 2, y: box.y + box.h / 2 },
  );

/** Wait until the loop has painted at least once. */
const painted = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => (window.__tessera?.frames.length ?? 0) > 0);
};

test.describe('projection', () => {
  test('a fixture shape is painted inside its projected box, and follows a drag exactly', async ({
    page,
  }) => {
    await page.goto(BOARD);
    await page.getByTestId('board').waitFor();
    await painted(page);

    // (i) The renderer says demo-0 is here; a pixel is actually there.
    const before = await boxOf(page, 'demo-0');
    expect(before.w).toBeGreaterThan(2);
    expect(before.h).toBeGreaterThan(2);
    expect(await paintedAt(page, before), 'pixel inside the projected box').toBe(true);

    // (ii) Drag 200px to the right from an empty corner of the canvas.
    //
    // The paint count is read BEFORE the drag. The first version of this test read it after,
    // and the drag's paint had already landed by then — so "wait for one more paint" waited for
    // a frame that had no reason to happen, and timed out against a renderer that was correct.
    const paintsBefore = await page.evaluate(() => window.__tessera?.frames.length ?? 0);
    const canvas = page.getByTestId('board');
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error('canvas has no bounding box');
    // MIDDLE button: a pan. Since Phase 4 a left-button drag on empty board is a marquee, which
    // moves nothing — and this test is about the camera moving the picture, not a shape.
    const start = { x: bounds.x + 20, y: bounds.y + bounds.height - 20 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(start.x + DRAG_PX, start.y, { steps: 10 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForFunction((n) => (window.__tessera?.frames.length ?? 0) > n, paintsBefore);

    const after = await boxOf(page, 'demo-0');
    // The arithmetic is the test's, not the page's: a 200 CSS px drag at dpr 1 is 200 device
    // px, and the box must have moved by that and nothing else.
    expect(after.x - before.x).toBeCloseTo(DRAG_PX, 3);
    expect(after.y - before.y).toBeCloseTo(0, 3);
    expect(after.w).toBeCloseTo(before.w, 3);

    expect(await paintedAt(page, after), 'pixel inside the NEW box').toBe(true);
    // And not the old one: the shape moved, it was not duplicated and the canvas was cleared.
    expect(await paintedAt(page, before), 'pixel inside the OLD box').toBe(false);
  });
});
