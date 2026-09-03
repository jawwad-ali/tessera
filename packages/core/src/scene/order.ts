import { generateKeyBetween } from 'fractional-indexing';

import type { FracIdx, ShapeId } from '../schema/shape.ts';
import type { Rng } from '../commands/command.ts';

/**
 * Draw order, as a sortable value on each shape rather than a position in a list.
 *
 * Yjs has no move operation — not in v13, not in the v14 RC — and a concurrent reorder of a
 * `Y.Array` does not merely risk duplication, it deterministically duplicates: measured, both
 * replicas converge on `["b","c","a","a"]`, which renders as a doubled shape. Moving ordering
 * into the value domain makes "bring to front" a single-key set, which merges by the ordinary
 * map rule and touches nothing else.
 */

/** `fractional-indexing`'s default digit set. Order matters: this is the sort alphabet. */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Jitter is drawn from the digits **excluding the lowest**.
 *
 * `fractional-indexing` rejects a key whose fractional part ends in the lowest digit, since
 * that is a non-canonical encoding of a shorter key — and a jittered key is fed straight back
 * in as a neighbour on the next insert. Drawing from `DIGITS.slice(1)` makes an invalid key
 * unrepresentable rather than rare.
 */
const JITTER_DIGITS = DIGITS.slice(1);

/**
 * Four jitter characters: ~13.8 million combinations from a 61-character alphabet.
 *
 * Enough that two clients inserting between the same neighbours in the same instant collide
 * essentially never, and short enough that keys do not grow noticeably under repeated
 * insertion at one spot.
 */
const JITTER_LENGTH = 4;

const jitter = (rng: Rng): string => {
  let suffix = '';
  for (let i = 0; i < JITTER_LENGTH; i++) {
    const index = Math.floor(rng() * JITTER_DIGITS.length);
    // `charAt` rather than `[]`: it returns `string` where indexing returns
    // `string | undefined`. `rng()` is only contracted to return [0, 1), so the clamp keeps
    // a returned 1.0 from walking off the end.
    suffix += JITTER_DIGITS.charAt(Math.min(index, JITTER_DIGITS.length - 1));
  }
  return suffix;
};

/**
 * An index strictly between two neighbours, jittered.
 *
 * `undefined` for either bound means "no neighbour on that side", so
 * `idxBetween(undefined, undefined, rng)` is the first shape on a board,
 * `idxBetween(undefined, first, rng)` sends a shape to the back, and
 * `idxBetween(last, undefined, rng)` brings one to the front.
 *
 * The jitter is the point. Without it two clients inserting between the same pair generate the
 * *identical* key, and the renderer is left breaking a tie that each replica may break
 * differently — which is a divergence users can see even though the document converged.
 *
 * `rng` is injected because `Math.random` is lint-banned in this package: a failing seed in
 * the property suite has to reproduce exactly.
 */
export const idxBetween = (
  before: FracIdx | undefined,
  after: FracIdx | undefined,
  rng: Rng,
): FracIdx => {
  // Jitter cannot simply be appended, and finding that out cost a failing test:
  // `generateKeyBetween('a0YEno', 'a1NGQg')` returns `'a1'`, which is a PREFIX of the upper
  // bound, so `'a1' + 'rFqR'` = `'a1rFqR'` sorts *above* `'a1NGQg'`. A key that escapes its
  // neighbours is worse than an unjittered one: it silently renders in the wrong place.
  //
  // So the candidate is verified rather than assumed. When it escapes, the base becomes the
  // new lower bound, which strictly narrows the interval — in the case above one extra pass
  // is enough, because `generateKeyBetween('a1', 'a1NGQg')` diverges on a digit instead of
  // extending a prefix.
  // Deliberately `string | null`, not `FracIdx | null`: this holds the raw keys
  // `generateKeyBetween` returns and consumes, and only the value handed back to the caller
  // has earned the brand.
  let lower: string | null = before ?? null;
  const upper: string | null = after ?? null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const base = generateKeyBetween(lower, upper);
    const candidate = `${base}${jitter(rng)}`;
    if (upper === null || candidate < upper) return candidate as FracIdx;
    lower = base;
  }

  // Correctness is unconditional; jitter is best-effort. Returning the unjittered key keeps
  // the ordering guarantee and costs only collision resistance, which is the right way round.
  return generateKeyBetween(lower, upper) as FracIdx;
};

/** The minimum a shape must expose to be drawn in order. `Shape` satisfies it. */
export interface Ordered {
  readonly id: ShapeId;
  readonly idx: FracIdx;
}

/**
 * Total order for rendering: index first, then id.
 *
 * The id tie-break is not defensive padding. Jitter makes an identical index unlikely rather
 * than impossible, and an unstable comparator would let two replicas render the same converged
 * document in a different order — the exact failure that makes a CRDT app look broken while
 * every convergence check passes.
 *
 * Nothing may derive draw order from map iteration: three byte-identical replicas iterate a
 * `Y.Map` in three different orders (measured).
 */
export const compareDrawOrder = (a: Ordered, b: Ordered): number => {
  if (a.idx !== b.idx) return a.idx < b.idx ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
};
