import type { DirtyFlagTable, DirtyMask, KeyDirtyTable } from './store.ts';

/**
 * What a change invalidates, as bit flags.
 *
 * Keyed to the renderer's **caches**, not to a shape's fields, because caches are what
 * actually get rebuilt. That is why `order` is its own flag: re-sorting the scene is the one
 * O(n log n) invalidation in the pipeline, so a drag that reported it would turn every frame
 * of every drag into a full re-sort.
 */

/** The one place a `DirtyMask` is minted from a literal. */
const mask = (bits: number): DirtyMask => bits as DirtyMask;

export const DIRTY_FLAGS: DirtyFlagTable = {
  geometry: mask(1),
  style: mask(2),
  ink: mask(4),
  order: mask(8),
  existence: mask(16),
};

/** Nothing invalidated. A write to a key no cache depends on still happened; it just repaints nothing. */
export const DIRTY_NONE: DirtyMask = mask(0);

export const combine = (left: DirtyMask, right: DirtyMask): DirtyMask => mask(left | right);

/**
 * A shape appearing or disappearing.
 *
 * `existence` implies `order`, stated here once rather than inferred at each consumer: a new
 * shape changes both what is on the board and where everything sorts, and a renderer that
 * had to work that out for itself would eventually get it wrong in one place.
 */
export const DIRTY_EXISTENCE: DirtyMask = combine(DIRTY_FLAGS.existence, DIRTY_FLAGS.order);

/**
 * What writing each key invalidates.
 *
 * A mapped type over `ShapeKey`, so adding a key is a compile error until this decision is
 * made. Two entries are deliberately `DIRTY_NONE`: nothing on screen is derived from `v` or
 * from `author` today, and claiming otherwise would repaint on a write that changes no pixel.
 */
export const KEY_DIRTY: KeyDirtyTable = {
  id: DIRTY_EXISTENCE,
  v: DIRTY_NONE,
  kind: DIRTY_EXISTENCE,
  t: DIRTY_FLAGS.geometry,
  idx: DIRTY_FLAGS.order,
  author: DIRTY_NONE,
  style: DIRTY_FLAGS.style,
  ink: DIRTY_FLAGS.ink,
};
