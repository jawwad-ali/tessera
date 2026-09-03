/**
 * A frame loop gated on a dirty flag.
 *
 * Never unconditional. A `requestAnimationFrame` that paints every frame regardless keeps a
 * laptop's GPU awake and its fans audible while nothing on screen is moving — and on a
 * read-only board, nothing is moving most of the time.
 *
 * The scheduler is injected. That is not testing ceremony: it is what lets a burst of 300
 * pointermove events be shown to collapse into one paint, synchronously, with no browser and
 * no timers — and it is the same seam a reduced-dpr-while-dragging strategy would hook later.
 */

export type Schedule = (callback: () => void) => number;
export type Cancel = (handle: number) => void;

export interface FrameLoop {
  /**
   * Mark the scene dirty and ensure exactly one frame is queued.
   *
   * Idempotent within a frame. Calling it 300 times before the frame runs paints once, which
   * is what makes frame cost independent of event rate.
   */
  readonly invalidate: () => void;
  /** Cancel any pending frame and ignore everything afterwards. */
  readonly stop: () => void;
}

export const createFrameLoop = (paint: () => void, schedule: Schedule, cancel: Cancel): FrameLoop => {
  let handle: number | undefined;
  let stopped = false;

  const run = (): void => {
    // Cleared *before* painting, so an invalidation raised during the paint queues the next
    // frame instead of being swallowed. A resize observed mid-paint is the ordinary case.
    handle = undefined;
    if (stopped) return;
    paint();
  };

  return {
    invalidate: () => {
      if (stopped || handle !== undefined) return;
      handle = schedule(run);
    },

    stop: () => {
      stopped = true;
      if (handle === undefined) return;
      // React unmounts with a frame in flight on every route change and every hot reload, and
      // painting into a detached canvas is the classic null dereference inside a rAF callback.
      cancel(handle);
      handle = undefined;
    },
  };
};
