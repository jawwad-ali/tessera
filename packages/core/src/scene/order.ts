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

/** One digit, uniformly, from `digits`. */
const digit = (digits: string, rng: Rng): string => {
  const index = Math.floor(rng() * digits.length);
  // `charAt` rather than `[]`: it returns `string` where indexing returns `string | undefined`.
  // `rng()` is only contracted to return [0, 1), so the clamp keeps a returned 1.0 from
  // walking off the end.
  return digits.charAt(Math.min(index, digits.length - 1));
};

/** Jitter with no upper bound to respect: every digit is a free choice. */
const freeJitter = (rng: Rng, length: number): string => {
  // MUTANT m1: jitter removed. Two clients inserting between the same neighbours now
  // generate the identical key. `rng() > 2` is never true, so this always returns ''.
  return rng() > 2 ? JITTER_DIGITS.charAt(0).repeat(length) : '';
};

/**
 * Jitter that is guaranteed to keep `base + suffix` strictly below `base + tail`.
 *
 * Called only when the generated base is a **prefix** of the upper bound, which is the case
 * where an appended suffix can escape it. Rather than generating a suffix and hoping, this
 * constructs one: walk the bound digit by digit, matching while there is no room below, and
 * take a strictly-lower digit at the first position that has room. Everything after that
 * position is free, because the comparison is already decided.
 *
 * It always terminates with a free choice. `fractional-indexing` rejects a key whose
 * fractional part ends in the lowest digit, so `tail` cannot be all-lowest-digits, so some
 * position has room.
 */
const jitterBelow = (tail: string, rng: Rng): string => {
  let suffix = '';

  // MUTANT m1: jitter removed here too.
  if (tail.length >= 0) return '';
  for (const bound of tail) {
    const ceiling = DIGITS.indexOf(bound);
    if (ceiling <= 0) {
      // No digit below this one. Match it and keep looking; the suffix stays a prefix of the
      // bound, which is still strictly below it as long as it stays shorter.
      suffix += DIGITS.charAt(0);
      continue;
    }
    suffix += digit(DIGITS.slice(0, ceiling), rng);
    return suffix + freeJitter(rng, JITTER_LENGTH - 1);
  }

  // Unreachable for a valid key, per the note above. One free digit keeps the result from
  // ending in the lowest digit if it ever were reached.
  return suffix + freeJitter(rng, 1);
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
 * differently — a divergence users can see even though the document converged.
 *
 * `rng` is injected because `Math.random` is lint-banned in this package: a failing seed in
 * the property suite has to reproduce exactly.
 *
 * ## Why the jitter is constructed rather than generated and checked
 *
 * Jitter cannot simply be appended, and finding that out cost a failing test:
 * `generateKeyBetween('a0YEno', 'a1NGQg')` returns `'a1'`, which is a PREFIX of the upper
 * bound, so `'a1' + 'rFqR'` sorts *above* `'a1NGQg'`. A key that escapes its neighbours is
 * worse than an unjittered one, because it silently renders in the wrong place.
 *
 * The first fix for that generated a candidate, compared it against the bound, narrowed the
 * lower bound and retried three times — then, if every attempt escaped, returned the
 * *unjittered* key. It was documented as "correctness is unconditional; jitter is
 * best-effort", and hammered over 240,000 insertions with zero fallbacks.
 *
 * **The convergence suite falsified it on its 1,492nd seed.** Repeated inserts into the same
 * shrinking gap exhaust the retry, and the fallback is `generateKeyBetween`, which is
 * deterministic — so two clients resolving "send to back" against the same snapshot get the
 * *identical* key. Jitter switched itself off in precisely the case it exists for, and the
 * 240,000-insertion hammer never saw it because those insertions were between wide neighbours.
 *
 * So there is no retry and no fallback now. The suffix is *constructed* to fit, which makes
 * jitter unconditional and the ordering guarantee unchanged.
 */
export const idxBetween = (
  before: FracIdx | undefined,
  after: FracIdx | undefined,
  rng: Rng,
): FracIdx => {
  // Deliberately `string | null`, not `FracIdx | null`: these hold the raw keys
  // `generateKeyBetween` returns and consumes, and only the value handed back has earned the
  // brand.
  const lower: string | null = before ?? null;
  const upper: string | null = after ?? null;

  // Refused legibly rather than left to the library, which throws `Error: " >= "` — a message
  // that tells a crash report nothing. Both halves are reachable:
  //
  //  - **A tie.** `compareDrawOrder` breaks ties on `id` precisely because two shapes *can*
  //    share an index, and there is provably no key strictly between `k` and `k`. So the next
  //    insert between two tied shapes crashes, and the caller has to widen past the tie —
  //    which the message says.
  //  - **Inverted bounds.** `generateKeyBetween('a1', 'a0')` does not complain, it returns
  //    `'a0V'`, which sorts *below* its own lower bound. A key that escapes its neighbours
  //    renders in the wrong place with nothing to notice, which is the same failure the jitter
  //    bug had. A crash is strictly better than that.
  if (lower !== null && upper !== null && lower >= upper) {
    throw new RangeError(
      `idxBetween needs a strictly increasing pair and got ${lower} >= ${upper}. ` +
        (lower === upper
          ? 'Two shapes share this index, so there is no gap between them — widen the ' +
            'neighbours past the tie before asking for a key.'
          : 'The neighbours are the wrong way round.'),
    );
  }

  const base = generateKeyBetween(lower, upper);

  // `base > lower` strictly, and a prefix of `lower` would be *below* it, so `base` is never a
  // prefix of the lower bound and any suffix keeps the result above it. Only the upper bound
  // can be escaped, and only when `base` is a prefix of it.
  const tail = upper?.startsWith(base) === true ? upper.slice(base.length) : null;

  const suffix = tail === null ? freeJitter(rng, JITTER_LENGTH) : jitterBelow(tail, rng);
  return `${base}${suffix}` as FracIdx;
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
