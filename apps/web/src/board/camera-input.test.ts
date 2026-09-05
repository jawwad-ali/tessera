import { describe as group, expect, it } from 'vitest';

import { screenToWorld } from '@tessera/core';
import { applyDrag, applyWheel } from './camera-input.ts';

/**
 * Sign conventions, pinned.
 *
 * The describe name matches the verifier in PHASES.md (`-t "camera input"`).
 *
 * Every one of these is a bug that ships green: the maths is symmetric, so a flipped sign
 * still produces a smooth, responsive, wrong-way board. The first draft of `applyDrag` had the
 * drag backwards, which reads as "the board runs away from your hand".
 */

const camera = { x: 100, y: 50, zoom: 2 };

group('camera input', () => {
  it('keeps the board point under the pointer while dragging', () => {
    // Pointer starts at CSS (300, 200), drags to (500, 200). Whatever board point was under
    // the pointer at the start must be under it at the end.
    const before = screenToWorld(camera, { x: 300, y: 200 });
    const after = applyDrag(camera, { x: 200, y: 0 });

    expect(screenToWorld(after, { x: 500, y: 200 })).toEqual(before);
  });

  it('scrolls content up when the wheel rolls down', () => {
    // The convention of every scrollable surface. Wheel down, content moves up, which means
    // the camera moves DOWN in board space.
    const after = applyWheel(camera, { deltaX: 0, deltaY: 100, ctrlKey: false, at: { x: 0, y: 0 } });

    expect(after.y).toBeGreaterThan(camera.y);
    expect(after.zoom).toBe(camera.zoom);
  });

  it('zooms about the pointer, so the point under it does not move', () => {
    const at = { x: 640, y: 360 };
    const before = screenToWorld(camera, at);

    const after = applyWheel(camera, { deltaX: 0, deltaY: -200, ctrlKey: true, at });

    expect(after.zoom).toBeGreaterThan(camera.zoom);
    expect(screenToWorld(after, at).x).toBeCloseTo(before.x, 9);
    expect(screenToWorld(after, at).y).toBeCloseTo(before.y, 9);
  });

  it('zooms in on a pinch-out and out on a pinch-in', () => {
    const out = applyWheel(camera, { deltaX: 0, deltaY: -100, ctrlKey: true, at: { x: 0, y: 0 } });
    const back = applyWheel(camera, { deltaX: 0, deltaY: 100, ctrlKey: true, at: { x: 0, y: 0 } });

    expect(out.zoom).toBeGreaterThan(camera.zoom);
    expect(back.zoom).toBeLessThan(camera.zoom);
  });

  it('never zooms past the camera limits, however hard the pinch', () => {
    const extreme = applyWheel(camera, {
      deltaX: 0,
      deltaY: -1_000_000,
      ctrlKey: true,
      at: { x: 0, y: 0 },
    });

    expect(Number.isFinite(extreme.zoom)).toBe(true);
    expect(extreme.zoom).toBeLessThanOrEqual(64);
  });
});
