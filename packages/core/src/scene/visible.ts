import type { Camera, Rect, Vec2 } from '../camera/camera.ts';
import type { Shape } from '../schema/shape.ts';
import type { SceneStore } from './store.ts';
import { rectsIntersect, visibleWorldRect } from '../camera/camera.ts';
import { compareDrawOrder } from './order.ts';
import { transformBounds } from '../schema/bounds.ts';

/**
 * What to paint, in what order, and where in device pixels.
 *
 * The renderer's entire input. Splitting it out as a pure function is what makes the pixel
 * assertion in `3.C1` diagnosable: when a shape lands in the wrong place, the question is
 * whether the geometry was wrong or the painting was, and those are answered by different
 * tests. This one answers the first without a browser.
 */

export interface Viewport {
  /** Viewport size in CSS pixels — what `ResizeObserver` reports. */
  readonly css: Vec2;
  /** Device pixel ratio, already capped by the caller. */
  readonly dpr: number;
}

export interface DrawItem {
  readonly shape: Shape;
  /**
   * Axis-aligned bounds in **device** pixels: rotation applied, camera applied, dpr applied.
   *
   * Not the geometry the painter draws — a rect is drawn through the canvas transform, not
   * from this box. This is what the box *is*, for culling, for the pixel test, and for
   * anything that needs to know a shape's on-screen extent without re-deriving it.
   */
  readonly device: Rect;
}

/**
 * How far outside the viewport a shape can be and still show.
 *
 * A stroke is centred on the path, so half of it lies outside the shape's own bounds; a
 * shape whose body is just off-screen can still paint into the viewport. Culling on the bare
 * bounds makes shapes pop in at the edges during a pan, which reads as a rendering bug.
 *
 * Fixed at 32 board units rather than derived per shape, because deriving it means reading
 * every shape's stroke width — which is the whole cost culling exists to avoid. 32 covers any
 * stroke this app can produce with room to spare.
 */
const CULL_PADDING = 32;

/**
 * Shapes to paint, culled to the viewport and sorted into draw order.
 *
 * The order is `(idx, id)`, never the order the spatial index returned: index order is cell
 * order, which has nothing to do with z, so painting in it puts shapes behind shapes they
 * should cover.
 */
export const visibleShapes = (
  scene: SceneStore,
  camera: Camera,
  viewport: Viewport,
): readonly DrawItem[] => {
  const world = visibleWorldRect(camera, viewport.css, CULL_PADDING);
  const scale = camera.zoom * viewport.dpr;

  const shapes: Shape[] = [];
  for (const id of scene.query(world)) {
    const shape = scene.get(id);
    // The index returns a superset — its cells are coarse — so the caller narrows. Skipping
    // this leaves shapes in the plan that paint nothing, which costs a transform and a fill
    // each and shows up as a frame-time floor that does not fall when you zoom in.
    if (shape === undefined) continue;
    if (!rectsIntersect(transformBounds(shape.t), world)) continue;
    shapes.push(shape);
  }
  shapes.sort(compareDrawOrder);

  return shapes.map((shape) => {
    const bounds = transformBounds(shape.t);
    return {
      shape,
      // Nothing is rounded. Half-pixel snapping is the painter's decision, made per stroke
      // width, and it cannot be made twice — rounding here would move the geometry that the
      // pixel test measures against.
      device: {
        x: (bounds.x - camera.x) * scale,
        y: (bounds.y - camera.y) * scale,
        w: bounds.w * scale,
        h: bounds.h * scale,
      },
    };
  });
};
