import { describe as group, expect, it } from 'vitest';

import { createFrameLoop } from './loop.ts';

/**
 * The frame loop.
 *
 * The describe name matches the verifier in PHASES.md (`-t "one frame"`).
 *
 * `requestAnimationFrame` is injected, so every question here is answered synchronously and
 * without a browser: how many paints a burst of invalidations produces, what happens to a
 * pending frame when the host unmounts, and whether a paint that dirties the scene recurses.
 */

/** A hand-cranked scheduler: nothing runs until `tick()` says so. */
const scheduler = () => {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    schedule: (callback: () => void): number => {
      const handle = next;
      next += 1;
      pending.set(handle, callback);
      return handle;
    },
    cancel: (handle: number): void => {
      pending.delete(handle);
    },
    /** Run every frame currently scheduled. Frames scheduled *by* those do not run. */
    tick: (): void => {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, callback] of due) callback();
    },
    get depth(): number {
      return pending.size;
    },
  };
};

group('one frame', () => {
  it('paints nothing until something asks it to', () => {
    const clock = scheduler();
    let paints = 0;

    createFrameLoop(() => (paints += 1), clock.schedule, clock.cancel);
    clock.tick();

    // A rAF that paints unconditionally keeps a laptop's GPU awake and its fans on while
    // nothing at all is moving. The loop is gated, so an idle board costs nothing.
    expect(paints).toBe(0);
    expect(clock.depth).toBe(0);
  });

  it('collapses a burst of invalidations into one paint', () => {
    const clock = scheduler();
    let paints = 0;
    const loop = createFrameLoop(() => (paints += 1), clock.schedule, clock.cancel);

    // 300 pointermove events inside one frame — the same shape as a drag.
    for (let n = 0; n < 300; n++) loop.invalidate();
    clock.tick();

    expect(paints).toBe(1);
  });

  it('paints again when something changes after a frame', () => {
    const clock = scheduler();
    let paints = 0;
    const loop = createFrameLoop(() => (paints += 1), clock.schedule, clock.cancel);

    loop.invalidate();
    clock.tick();
    loop.invalidate();
    clock.tick();

    expect(paints).toBe(2);
  });

  it('does not recurse when a paint dirties the scene', () => {
    const clock = scheduler();
    let paints = 0;
    const loop = createFrameLoop(
      () => {
        paints += 1;
        // A resize observed during paint, or a lazily-built index finishing: legitimate, and
        // a synchronous re-entrant paint here is an unbounded stack rather than a frame.
        if (paints < 3) loop.invalidate();
      },
      clock.schedule,
      clock.cancel,
    );

    loop.invalidate();
    clock.tick();

    expect(paints).toBe(1);
    // The next frame is queued, not taken.
    expect(clock.depth).toBe(1);
  });

  it('cancels a pending frame when it stops', () => {
    const clock = scheduler();
    let paints = 0;
    const loop = createFrameLoop(() => (paints += 1), clock.schedule, clock.cancel);

    loop.invalidate();
    loop.stop();
    clock.tick();

    // React unmounts a component with a frame in flight on every route change and on every
    // hot reload. Painting into a detached canvas is the classic "cannot read property of
    // null" in a rAF callback.
    expect(paints).toBe(0);
    expect(clock.depth).toBe(0);
  });

  it('ignores invalidations after it stops', () => {
    const clock = scheduler();
    let paints = 0;
    const loop = createFrameLoop(() => (paints += 1), clock.schedule, clock.cancel);

    loop.stop();
    loop.invalidate();
    clock.tick();

    expect(paints).toBe(0);
  });
});
