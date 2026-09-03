import type { KeyClassTable, ShapeKey } from './shape.ts';

/**
 * How each key behaves under repeated writes.
 *
 * A mapped type over {@link ShapeKey}, so adding a key is a compile error until its write
 * behaviour is declared here. The table cannot drift from the key set because it is
 * generated from it.
 *
 * The classification is a **measurement**, not a taste. A repeated write to one key merges
 * into the previous struct only if it is the only thing that client wrote that frame:
 * writing `t` alone costs +2 structs over a gesture, writing `t` and `style` together costs
 * +120. So `hot` is not "written often" in the abstract — it is "written many times inside
 * one gesture", which is the case the merge either survives or does not.
 */
export const KEY_CLASS: KeyClassTable = {
  /** Assigned once by the creating client and never rewritten. */
  id: 'birth',
  /** The shape's own schema version. Additive-only migration means it never changes. */
  v: 'birth',
  /** A rect never becomes a pen. Changing kind is a delete and a create. */
  kind: 'birth',
  /** Every frame of every drag, resize and rotate. */
  t: 'hot',
  /** A deliberate reorder — bring to front, send backward. Occasional. */
  idx: 'cold',
  /** Written by the store at creation from the commit stamp, never afterwards. */
  author: 'birth',
  /** Hot because a colour picker or an opacity slider is a drag, not a single click. */
  style: 'hot',
  /** A finished stroke, written once on pointerup and immutable thereafter. */
  ink: 'birth',
};

/** The keys a command may not write more than one of. Derived, so it cannot drift. */
export const HOT_KEYS: readonly ShapeKey[] = Object.entries(KEY_CLASS)
  .filter(([, keyClass]) => keyClass === 'hot')
  .map(([key]) => key as ShapeKey);
