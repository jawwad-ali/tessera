import type { Rect, Vec2 } from '../camera/camera.ts';
import type { Transform } from './shape.ts';

/**
 * Axis-aligned bounds of a shape, in board units.
 *
 * These feed the spatial index, which drives both culling and the first tier of hit testing.
 * Bounds that are too small drop a visible shape mid-pan and make it unclickable; bounds far
 * too large defeat the point of culling. Rotation is where this is normally got wrong — a
 * quarter-turned wide rectangle is a *tall* box.
 *
 * Convention, fixed here and relied on everywhere: `x`/`y` is the top-left of the *unrotated*
 * box, and `rot` turns the shape about its own centre. That is what every editor does, and it
 * is why the centre does not move when a shape is rotated.
 */

/**
 * The largest coordinate or extent for which the arithmetic below cannot overflow.
 *
 * Derived, not chosen: `transformBounds` computes `(w/2)*cos + (h/2)*sin` and then doubles
 * it, and `shapeCorners` adds an offset to a centre, so the worst case is roughly
 * `(|coord| + |extent|) * 2`. A quarter of `Number.MAX_VALUE` leaves that headroom with a
 * wide margin, and it is still ~4.5e307 - astronomically larger than any board.
 *
 * This exists because `Finite` is not a sufficient guard. Every field of
 * `{x: 1e308, w: 1.7e308, h: 1.7e308}` is finite and satisfies the brand, and the Rect it
 * derives is not - and `SpatialHash.set` throws on a non-finite bound, so a
 * hostile-but-finite shape from a peer would crash the insert. The resolver range-checks
 * against this at the observer boundary and records a Quirk; nothing clamps silently.
 */
export const COORD_LIMIT = Number.MAX_VALUE / 4;

/** The four corners of a shape, in board space, with rotation applied. */
export const shapeCorners = (transform: Transform): readonly [Vec2, Vec2, Vec2, Vec2] => {
  const { x, y, w, h, rot } = transform;
  const centreX = x + w / 2;
  const centreY = y + h / 2;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  const corner = (dx: number, dy: number): Vec2 => ({
    x: centreX + dx * cos - dy * sin,
    y: centreY + dx * sin + dy * cos,
  });

  const halfW = w / 2;
  const halfH = h / 2;
  return [corner(-halfW, -halfH), corner(halfW, -halfH), corner(halfW, halfH), corner(-halfW, halfH)];
};

/**
 * The axis-aligned box containing a transform, rotation included.
 *
 * Derived from the half-extents rather than from the corners: for an AABB of a rotated
 * rectangle the projections are exactly `|w/2·cos| + |h/2·sin|` and `|w/2·sin| + |h/2·cos|`,
 * so this needs four trig-free multiplies after one `cos`/`sin` rather than four corner
 * constructions and eight comparisons. That matters because this runs per shape on the
 * cold-load path, where it is multiplied by the board size.
 *
 * `Math.abs` on both terms is what makes it correct for every quadrant; dropping it gives
 * bounds that are right for a 30-degree rotation and wrong for 150.
 */
export const transformBounds = (transform: Transform): Rect => {
  const { x, y, w, h, rot } = transform;
  const cos = Math.abs(Math.cos(rot));
  const sin = Math.abs(Math.sin(rot));

  const halfW = (w / 2) * cos + (h / 2) * sin;
  const halfH = (w / 2) * sin + (h / 2) * cos;

  return {
    x: x + w / 2 - halfW,
    y: y + h / 2 - halfH,
    w: halfW * 2,
    h: halfH * 2,
  };
};
