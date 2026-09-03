import type { DocValue, EncodeShape, Style, Transform } from './shape.ts';

/**
 * Turning a resolved shape back into the values the document holds.
 *
 * The counterpart of `resolveShape`, and the only place a shape becomes document content.
 * It exists as its own step rather than a cast because two things have to happen on the way
 * out that no cast can do.
 *
 * **`-0` is normalised to `0`.** A rotation reaches `-0` through ordinary arithmetic and is
 * the same shape on screen, so the resolver accepts it untouched — but `0` and `-0` encode
 * to different bytes, and the convergence probe hashes bytes. Normalising here means two
 * replicas that agree about the picture also agree about the digest.
 *
 * **Objects are rebuilt as fresh literals.** A `Transform` is an interface, and an interface
 * has no implicit index signature, so it is not assignable to {@link DocValue} — which is
 * the type system correctly refusing to let a value with a prototype into the document. The
 * rebuild is what makes the value structurally what it claims to be.
 */

/** `-0` and `0` are the same number and different bytes. The document gets the one. */
const normalise = (value: number): number => (value === 0 ? 0 : value);

const encodeTransform = (t: Transform): DocValue => ({
  x: normalise(t.x),
  y: normalise(t.y),
  w: normalise(t.w),
  h: normalise(t.h),
  rot: normalise(t.rot),
});

const encodeStyle = (style: Style): DocValue => ({
  fill: style.fill,
  stroke: style.stroke,
  strokeWidth: normalise(style.strokeWidth),
  opacity: normalise(style.opacity),
});

/** The whole-container form: every key of a shape, for a create's single `put`. */
export const encodeShape: EncodeShape = (shape) => {
  const common = {
    id: shape.id,
    v: shape.v,
    kind: shape.kind,
    t: encodeTransform(shape.t),
    idx: shape.idx,
    author: shape.author,
    style: encodeStyle(shape.style),
  };

  if (shape.kind !== 'pen') return common;

  return {
    ...common,
    ink: { q: normalise(shape.ink.q), d: shape.ink.d, n: normalise(shape.ink.n) },
  };
};

/** One key's value, for a `set`. Exported per-key so a caller cannot write an unencoded one. */
export const encodeTransformValue = encodeTransform;
export const encodeStyleValue = encodeStyle;
