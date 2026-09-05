import type { Rect } from '@tessera/core';

/**
 * The instrumentation behind `3.C1` and `3.C4`.
 *
 * Present only when the URL asks for it (`?bench=1`), so a visitor's board carries none of it.
 * Two things are exposed on `window.__tessera`:
 *
 *  - `frames` — every paint's duration in ms. The frame-time measurement reads these back, and
 *    this is the "harness path" column of the measurement envelope: the number comes from here
 *    and from nowhere else.
 *  - `plan()` — the shapes the renderer currently believes it painted, with their device-pixel
 *    boxes. The pixel test asks this *where* a shape is, then reads the canvas back to check a
 *    pixel is actually there, then drags and checks the box moved by exactly the drag.
 *
 * The pixel test could instead recompute the projection itself from the fixture. It does not,
 * on purpose: that would make the test a second implementation of the projection agreeing with
 * the first, and the projection is already tested in `core`. What the browser test uniquely
 * proves is that the *painting* landed where the *projection* said.
 */

export interface PlannedShape {
  readonly id: string;
  readonly device: Rect;
}

export interface TesseraBench {
  /** Paint durations in ms, one per frame actually painted. */
  readonly frames: number[];
  /** The current draw plan, in device pixels. */
  readonly plan: () => readonly PlannedShape[];
}

declare global {
  interface Window {
    __tessera?: TesseraBench;
  }
}

export const installBench = (plan: () => readonly PlannedShape[]): TesseraBench => {
  const sink: TesseraBench = { frames: [], plan };
  window.__tessera = sink;
  return sink;
};

/**
 * Wrap a paint so its duration is recorded.
 *
 * `performance.now()` around the call measures the JavaScript side of the frame — the cull,
 * the plan, and the Canvas 2D calls being *issued*. Compositing happens after the frame
 * returns and is not in this number; the browser's own long-frame count is the check on that,
 * and the measurement reports both.
 */
export const timed = (sink: TesseraBench, paint: () => void): (() => void) => {
  return () => {
    const started = performance.now();
    paint();
    sink.frames.push(performance.now() - started);
  };
};
