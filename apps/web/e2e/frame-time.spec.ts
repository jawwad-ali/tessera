import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * `3.C4` — the pre-registered counterfactual, LOD off.
 *
 * p50 / p95 / p99 paint time and long-frame count at zoom-to-fit, dpr 1, from a production
 * build, at 5,000 shapes and then upward until p95 crosses one vsync — that crossing is the
 * "breaking point" the criterion asks for. This is the baseline Phase 11 is measured against, so
 * it is taken *before* any optimisation exists and committed with the sha that produced it.
 *
 * Never a mean and never "fps": a mean hides the frames a user actually notices and fps is a
 * vsync ceiling, not a measurement. Each run is a real drag — one pointer move per animation
 * frame, alternating direction so the camera stays at zoom-to-fit and culling removes nothing.
 * That is the worst case by design: ARCHITECTURE §7, *"culling saves nothing at zoom-to-fit,
 * which is the first thing every user does."*
 */

/** 5,000 is the registered workload; the rest are the search for the breaking point. */
const COUNTS = [5_000, 7_500, 10_000] as const;
const SAMPLE_FRAMES = 60;
/** From PHASES.md `3.C4`: one vsync at 60Hz. */
const LONG_FRAME_MS = 16.7;
const OUT_DIR = resolve(process.cwd(), '../../bench-out');

const percentile = (sorted: readonly number[], p: number): number => {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? Number.NaN;
};

const nextFrame = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          done();
        });
      }),
  );

test.describe('frame time', () => {
  for (const shapes of COUNTS) {
    test(`${shapes} shapes at zoom-to-fit, LOD off`, async ({ page, browserName }) => {
      await page.goto(`/b/demo?seed=1&n=${shapes}&bench=1`);
      await page.getByTestId('board').waitFor();
      await page.waitForFunction(() => (window.__tessera?.frames.length ?? 0) > 0);

      // The first paints include the index warming up; the sample starts after them.
      await page.evaluate(() => {
        window.__tessera?.frames.splice(0);
      });

      const canvas = page.getByTestId('board');
      const bounds = await canvas.boundingBox();
      if (bounds === null) throw new Error('canvas has no bounding box');
      const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };

      // One move per frame, four pixels each way, so every frame repaints the whole fit view
      // and the camera never drifts far enough for culling to start helping.
      //
      // MIDDLE button: a pan. Since Phase 4 a left-button drag is a select or move gesture, and
      // the static layer — whose paint this measures — deliberately does not repaint for those.
      // The first run after the interaction layer landed recorded zero frames for exactly that
      // reason, which is the layering doing its job.
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down({ button: 'middle' });
      for (let frame = 0; frame < SAMPLE_FRAMES; frame++) {
        const dx = frame % 2 === 0 ? 4 : -4;
        await page.mouse.move(centre.x + dx, centre.y);
        await nextFrame(page);
      }
      await page.mouse.up({ button: 'middle' });
      await nextFrame(page);

      const frames = await page.evaluate(() => [...(window.__tessera?.frames ?? [])]);
      const environment = await page.evaluate(() => ({
        dpr: window.devicePixelRatio,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        shapesVisible: window.__tessera?.plan().length ?? 0,
      }));

      // n >= 30 is the pre-registered sample floor.
      expect(frames.length).toBeGreaterThanOrEqual(30);
      // Zoom-to-fit means the cull removed nothing, or this is not the baseline it claims to be.
      expect(environment.shapesVisible).toBe(shapes);

      const sorted = [...frames].sort((a, b) => a - b);
      const result = {
        sha: process.env['GITHUB_SHA'] ?? 'local',
        takenAt: new Date().toISOString(),
        browser: browserName,
        workload: `${shapes} rect shapes, seed 1, zoom-to-fit, one pointermove per frame, LOD off`,
        shapes,
        n: frames.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted[sorted.length - 1],
        longFrames: frames.filter((ms) => ms > LONG_FRAME_MS).length,
        longFrameThresholdMs: LONG_FRAME_MS,
        ...environment,
      };

      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(resolve(OUT_DIR, `frame-time-${shapes}.json`), JSON.stringify(result, null, 2));

      // Printed so the number is in the run log, not only in a file nobody opens.
      console.log(
        `frame time @ ${shapes} shapes, dpr ${environment.dpr}: ` +
          `p50 ${result.p50.toFixed(2)}ms  p95 ${result.p95.toFixed(2)}ms  p99 ${result.p99.toFixed(2)}ms  ` +
          `long frames ${result.longFrames}/${result.n}`,
      );
    });
  }
});
