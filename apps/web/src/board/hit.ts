import type { SceneStore, Shape, ShapeId, Vec2 } from '@tessera/core';
import { compareDrawOrder } from '@tessera/core';

/**
 * Which shape is under a board point.
 *
 * Three tiers, ARCHITECTURE §7. The spatial index narrows the board to candidates; an oriented
 * box test rejects the candidates whose *rotated body* the point misses; `isPointInStroke` on a
 * 1×1 scratch context decides freehand ink. Only the first two are here. A rectangle is exact at
 * tier two, and the pen tool is this phase's release valve, so the third tier arrives with it.
 *
 * No colour-coded hit canvas. That costs a second full draw pass and a pixel read, and reading
 * back from the main accelerated canvas can de-accelerate it.
 */

/**
 * Tier two: the point in the shape's own frame, against its own half-extents.
 *
 * The inverse of `shapeCorners`: translate to the centre, rotate by `-rot`, compare. `slop`
 * widens the box on every side, in board units, so a near miss on the outline of a thin shape
 * still grabs it.
 */
const insideRotated = (shape: Shape, point: Vec2, slop: number): boolean => {
  const { x, y, w, h, rot } = shape.t;
  const dx = point.x - (x + w / 2);
  const dy = point.y - (y + h / 2);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  return Math.abs(localX) <= w / 2 + slop && Math.abs(localY) <= h / 2 + slop;
};

/**
 * The topmost shape under `point`, or nothing.
 *
 * `slop` is in **board units**. The caller converts from screen space — ARCHITECTURE §7 gives
 * `10 / cameraScale` — because a fixed board-unit slop is un-clickable when zoomed out and
 * grabs the neighbour when zoomed in.
 */
export const hitTest = (scene: SceneStore, point: Vec2, slop: number): ShapeId | undefined => {
  // Tier one. The index returns a superset in cell order, which has nothing to do with z.
  const candidates: Shape[] = [];
  for (const id of scene.query({ x: point.x - slop, y: point.y - slop, w: slop * 2, h: slop * 2 })) {
    const shape = scene.get(id);
    if (shape !== undefined) candidates.push(shape);
  }

  // Topmost first: the shape a user sees is the one they mean, and a shape hidden underneath
  // is exactly the one they do not.
  candidates.sort(compareDrawOrder);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const shape = candidates[index];
    if (shape !== undefined && insideRotated(shape, point, slop)) return shape.id;
  }
  return undefined;
};
