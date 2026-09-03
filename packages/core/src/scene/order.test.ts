import fc from 'fast-check';
import { describe as group, expect, it } from 'vitest';

import type { FracIdx, ShapeId } from '../schema/shape.ts';
import { compareDrawOrder, idxBetween } from './order.ts';

/**
 * Two people reordering overlapping shapes.
 *
 * Draw order is a *value* on each shape, not a position in a list, because Yjs has no move
 * operation in v13 or in the v14 RC — and a concurrent reorder of a `Y.Array` does not merely
 * risk duplication, it deterministically duplicates: both replicas converge on
 * `["b","c","a","a"]`, which renders as a doubled shape.
 *
 * These tests describe what users see, not how the key is built.
 */

/** A deterministic stand-in for injected entropy, so a failure reproduces. */
const seeded = (start: number): (() => number) => {
  let state = start;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};

const shape = (id: string, idx: string): { id: ShapeId; idx: FracIdx } => ({
  id: id as ShapeId,
  idx: idx as FracIdx,
});

group('a shape can be placed anywhere in the order', () => {
  it('places the first shape on an empty board', () => {
    const first = idxBetween(undefined, undefined, seeded(1));
    expect(typeof first).toBe('string');
    expect(first.length).toBeGreaterThan(0);
  });

  it('places a shape strictly between two neighbours', () => {
    const rng = seeded(7);
    const low = idxBetween(undefined, undefined, rng);
    const high = idxBetween(low, undefined, rng);
    const middle = idxBetween(low, high, rng);

    expect(low < middle).toBe(true);
    expect(middle < high).toBe(true);
  });

  it('sends a shape to the back and brings one to the front', () => {
    const rng = seeded(11);
    const only = idxBetween(undefined, undefined, rng);

    expect(idxBetween(undefined, only, rng) < only).toBe(true);
    expect(idxBetween(only, undefined, rng) > only).toBe(true);
  });
});

group('two clients reordering at the same spot do not collide', () => {
  it('produces different keys for the same neighbour pair', () => {
    // The entire reason the index is jittered. Without it, two clients inserting between the
    // same two neighbours generate the IDENTICAL key, and the renderer then has to break a
    // tie that each replica may break differently.
    const rng = seeded(3);
    const low = idxBetween(undefined, undefined, rng);
    const high = idxBetween(low, undefined, rng);

    const alice = idxBetween(low, high, seeded(1000));
    const bob = idxBetween(low, high, seeded(9999));

    expect(alice).not.toBe(bob);
    // And both still land where the user asked.
    for (const key of [alice, bob]) {
      expect(low < key).toBe(true);
      expect(key < high).toBe(true);
    }
  });

  it('keeps both shapes present and ordered after the collision', () => {
    // Convergence is not enough on its own: after two concurrent inserts, every shape must
    // still appear exactly once and every replica must agree on the sequence.
    const rng = seeded(5);
    const low = idxBetween(undefined, undefined, rng);
    const high = idxBetween(low, undefined, rng);
    const alice = idxBetween(low, high, seeded(21));
    const bob = idxBetween(low, high, seeded(22));

    const shapes = [shape('d', high), shape('b', alice), shape('a', low), shape('c', bob)];
    const drawn = [...shapes].sort(compareDrawOrder).map((entry) => entry.id);

    expect(new Set(drawn).size).toBe(4);
    expect(drawn[0]).toBe('a');
    expect(drawn[3]).toBe('d');
  });
});

group('every replica renders the same order', () => {
  it('is independent of the order the shapes arrived in', () => {
    // Three byte-identical replicas iterate a Y.Map in three different orders (measured), so
    // draw order must come from sorting the index and never from iteration.
    const a = shape('a', 'a0');
    const b = shape('b', 'a1');
    const c = shape('c', 'a2');
    const permutations = [
      [a, b, c],
      [c, b, a],
      [b, a, c],
    ];

    const rendered = permutations.map((permutation) =>
      [...permutation].sort(compareDrawOrder).map((entry) => entry.id),
    );

    expect(rendered[0]).toEqual(['a', 'b', 'c']);
    expect(rendered[1]).toEqual(rendered[0]);
    expect(rendered[2]).toEqual(rendered[0]);
  });

  it('breaks an exact index tie by id, so the order is still total', () => {
    // Jitter makes an identical index unlikely, not impossible. An unstable comparator would
    // let two replicas render the same converged document differently.
    const tied = [shape('z', 'a1'), shape('a', 'a1')];

    expect([...tied].sort(compareDrawOrder).map((entry) => entry.id)).toEqual(['a', 'z']);
    expect([...tied].reverse().sort(compareDrawOrder).map((entry) => entry.id)).toEqual(['a', 'z']);
  });
});

/**
 * The bounds invariant, over many seeds rather than one.
 *
 * The prefix bug above was found by a single lucky seed: `generateKeyBetween` returned a key
 * that was a *prefix* of the upper bound, so appended jitter sorted above it. One example
 * proves one case; this proves the property.
 */
group('a generated index is always strictly between its neighbours', () => {
  it('holds across arbitrary insertion sequences', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(fc.nat({ max: 40 }), { minLength: 1, maxLength: 40 }),
        (seed, positions) => {
          const rng = seeded(seed);
          const keys: FracIdx[] = [idxBetween(undefined, undefined, rng)];

          for (const raw of positions) {
            // Insert at an arbitrary slot, including both ends.
            const at = raw % (keys.length + 1);
            const before = at === 0 ? undefined : keys[at - 1];
            const after = at === keys.length ? undefined : keys[at];

            const key = idxBetween(before, after, rng);

            if (before !== undefined && !(before < key)) return false;
            if (after !== undefined && !(key < after)) return false;

            keys.splice(at, 0, key);
          }

          // And the list is still sorted and free of duplicates, which is what the renderer
          // relies on.
          const sorted = [...keys].sort();
          return keys.every((key, i) => key === sorted[i]) && new Set(keys).size === keys.length;
        },
      ),
      { numRuns: 400 },
    );
  });
});
