import type { Camera, DrawItem, Viewport } from '@tessera/core';
import { deviceMatrix } from '@tessera/core';

/**
 * The static layer: committed shapes, redrawn when the camera or the scene changes.
 *
 * Not per frame. A rAF that paints unconditionally keeps a laptop's GPU awake and its fans on
 * while nothing moves, so the loop is gated on a dirty flag and this function is what the flag
 * eventually calls.
 */

/**
 * The slice of `CanvasRenderingContext2D` this layer uses.
 *
 * Declared structurally rather than imported, for two reasons. `@tessera/core` carries the
 * types this file consumes and is compiled with `types: []` and no DOM lib, so a DOM type
 * cannot cross that boundary. And a narrow interface is what lets the call sequence be asserted
 * against a recorder — the questions that matter here are "how many transforms" and "in what
 * order", and no pixel readback can answer either.
 *
 * `CanvasRenderingContext2D` satisfies it structurally, so the real call site needs no cast.
 */
export interface Painter2D {
  // The real context accepts gradients and patterns here too; the union has to match or the
  // real `CanvasRenderingContext2D` is not assignable to this. This layer only ever writes
  // strings.
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  clearRect: (x: number, y: number, w: number, h: number) => void;
  beginPath: () => void;
  rect: (x: number, y: number, w: number, h: number) => void;
  fill: () => void;
  stroke: () => void;
}

/**
 * Paint a draw plan.
 *
 * The plan is already culled and ordered — see `visibleShapes`. This function decides nothing
 * about *what* to draw, which is what keeps the geometry testable without a canvas and the
 * painting testable without a browser.
 */
export const paintStatic = (
  ctx: Painter2D,
  plan: readonly DrawItem[],
  camera: Camera,
  viewport: Viewport,
): void => {
  // Identity first, so the clear covers the backing store rather than a camera-transformed
  // slice of it. Clearing under the camera transform leaves the previous frame visible
  // wherever the camera has moved, which is the smearing you see while panning.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, viewport.css.x * viewport.dpr, viewport.css.y * viewport.dpr);

  // One transform for the whole plan. Per-shape transforms turn a 5,000-shape board into
  // 5,000 state changes, and the state change is the expensive half of a Canvas 2D call.
  const matrix = deviceMatrix(camera, viewport.dpr);
  ctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);

  for (const item of plan) {
    const { t, style } = item.shape;

    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    // World units, applied under the transform, so a stroke scales with its shape. Dividing
    // by the camera scale would give a hairline that stays the same device width at every
    // zoom — right for a selection outline, wrong for a line someone drew.
    ctx.lineWidth = style.strokeWidth;

    ctx.beginPath();
    ctx.rect(t.x, t.y, t.w, t.h);
    ctx.fill();
    ctx.stroke();
  }
};
