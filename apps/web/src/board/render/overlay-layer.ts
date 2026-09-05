import type { Camera, Rect, Shape, Viewport } from '@tessera/core';
import { deviceMatrix } from '@tessera/core';
import type { Painter2D } from './static-layer.ts';

/**
 * The overlay: everything that is not a committed shape.
 *
 * Its first drawers arrive in this phase, which is why it exists now and not in Phase 3: the
 * in-flight drag, the marquee, and the selection handles. All three are tier-1 state that
 * changes every frame of a gesture, and painting them on their own canvas means the static
 * layer — 5,000 committed shapes — is not repainted for any of them.
 */

export interface OverlayView {
  /** Board-space box around the selection, or nothing selected. */
  readonly selection: Rect | undefined;
  /** Board-space marquee in progress, or none. */
  readonly marquee: Rect | undefined;
  /** Shapes being dragged, already at their in-flight geometry. Board space. */
  readonly ghosts: readonly Shape[];
}

/** Handle size in CSS pixels. Fixed on screen — a handle that shrinks with zoom is un-grabbable. */
const HANDLE_CSS = 8;
const HANDLE_FILL = '#ffffff';
const HANDLE_STROKE = '#2563eb';
const SELECTION_STROKE = '#2563eb';
const MARQUEE_FILL = 'rgba(37, 99, 235, 0.12)';
const MARQUEE_STROKE = '#2563eb';

/** A board rect projected to device pixels. */
const toDevice = (rect: Rect, camera: Camera, viewport: Viewport): Rect => {
  const scale = camera.zoom * viewport.dpr;
  return {
    x: (rect.x - camera.x) * scale,
    y: (rect.y - camera.y) * scale,
    w: rect.w * scale,
    h: rect.h * scale,
  };
};

const strokeBox = (ctx: Painter2D, box: Rect, stroke: string, width: number, fill?: string): void => {
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  if (fill !== undefined) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
};

/**
 * Selection handles, in **screen space**.
 *
 * The transform is reset and the bounds projected by hand, so a handle is 8 CSS px at every
 * zoom. Drawn under the camera transform they would be 8 board units — invisible zoomed out,
 * covering the shape zoomed in. Inert this phase: resize and rotate stay on the cut list.
 */
const paintHandles = (ctx: Painter2D, selection: Rect, camera: Camera, viewport: Viewport): void => {
  const box = toDevice(selection, camera, viewport);
  const size = HANDLE_CSS * viewport.dpr;
  const half = size / 2;

  strokeBox(ctx, box, SELECTION_STROKE, viewport.dpr);

  const xs = [box.x, box.x + box.w / 2, box.x + box.w];
  const ys = [box.y, box.y + box.h / 2, box.y + box.h];
  for (const x of xs) {
    for (const y of ys) {
      // Eight handles, not nine: the centre is where the shape is, not a handle.
      if (x === xs[1] && y === ys[1]) continue;
      strokeBox(ctx, { x: x - half, y: y - half, w: size, h: size }, HANDLE_STROKE, viewport.dpr, HANDLE_FILL);
    }
  }
};

/**
 * Paint the overlay.
 *
 * Ghosts are painted under the camera transform like committed shapes — they are shapes, at a
 * position that is not yet committed. Handles and the marquee are painted in screen space
 * afterwards, so their line widths and handle sizes are in device pixels.
 */
export const paintOverlay = (ctx: Painter2D, view: OverlayView, camera: Camera, viewport: Viewport): void => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, viewport.css.x * viewport.dpr, viewport.css.y * viewport.dpr);

  if (view.ghosts.length > 0) {
    const m = deviceMatrix(camera, viewport.dpr);
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    for (const shape of view.ghosts) {
      ctx.fillStyle = shape.style.fill;
      ctx.strokeStyle = shape.style.stroke;
      ctx.lineWidth = shape.style.strokeWidth;
      ctx.beginPath();
      ctx.rect(shape.t.x, shape.t.y, shape.t.w, shape.t.h);
      ctx.fill();
      ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  if (view.selection !== undefined) paintHandles(ctx, view.selection, camera, viewport);

  if (view.marquee !== undefined) {
    strokeBox(ctx, toDevice(view.marquee, camera, viewport), MARQUEE_STROKE, viewport.dpr, MARQUEE_FILL);
  }
};
