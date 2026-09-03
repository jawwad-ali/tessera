import { describe as group, expect, it } from 'vitest';

import type { FracIdx, ShapeId } from '@tessera/core';
import { checkScene, createMemoryStore, idxBetween } from '@tessera/core';
import type { Action } from './plan.ts';
import { emit, seededRng } from './plan.ts';

/**
 * The regression corpus, in readable form.
 *
 * `harness/seeds/regressions.json` records the seed and path that reproduce each `found` bug
 * through the generator. This file replays the *shrunk* counterexample directly, because a
 * corpus entry that exists only as a seed stops reproducing anything the moment the generator
 * changes shape — and the generator will change, every time an action is added.
 *
 * Both tests below fail on the implementation that shipped at `abd94be`.
 */

/**
 * `found-1`: two shapes sent to the same tight gap received the identical index.
 *
 * Shrunk from seed 1,492 of base seed 20260903, 48 shrinks, five actions. Reported
 * `distinct-index` on the fourth action, where both shapes landed on `a011E`.
 */
const FOUND_1: readonly Action[] = [
  { kind: 'draw', x: 0, y: 0, w: 1, h: 1, rot: 0, pen: false },
  { kind: 'draw', x: 0, y: 0, w: 1, h: 1, rot: 0, pen: false },
  { kind: 'restack', pick: 0, gap: 0 },
  { kind: 'restackTogether', picks: [0, 0], gap: 0 },
  { kind: 'dragMany', picks: [0, 0], x: 0, y: 0 },
];

const FOUND_1_RNG_SEED = 23;

group.skip('repro', () => {
  it('found-1: replays the shrunk counterexample with no violation', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    const rng = seededRng(FOUND_1_RNG_SEED);
    let minted = 0;
    const nextId = (): ShapeId => {
      minted += 1;
      return `s${minted}` as ShapeId;
    };

    for (const action of FOUND_1) {
      const emitted = emit(action, store.drawOrder(), nextId, rng);
      store.gesture((tx) => {
        for (const command of emitted.commands) tx.apply(command);
      });

      // Named in the message, because "the corpus is red" is not a bug report.
      expect(
        checkScene(store).map((violation) => `${violation.invariant}: ${violation.detail}`),
        `after ${action.kind}`,
      ).toEqual([]);
    }
  });

  it('found-1: keeps two inserts into the same tight gap distinct and in bounds', () => {
    const rng = seededRng(FOUND_1_RNG_SEED);

    // The mechanism in isolation: two clients resolving "send to back" against the same
    // snapshot, into a gap that keeps shrinking because the previous round narrowed it. The
    // retry-and-fall-back implementation produced identical keys from the third round on,
    // because its fallback was `generateKeyBetween`, which is deterministic.
    //
    // 32 rounds rather than the 8 that first showed it: the failure appeared at round 2, so a
    // loop that stops at 8 would pass again on the next implementation that only defers it.
    let upper = 'a0' as FracIdx;
    for (let round = 0; round < 32; round++) {
      const first = idxBetween(undefined, upper, rng);
      const second = idxBetween(undefined, upper, rng);

      expect(first, `round ${round}, gap below ${upper}`).not.toBe(second);
      expect(first < upper, `round ${round}: ${first} must sort below ${upper}`).toBe(true);
      expect(second < upper, `round ${round}: ${second} must sort below ${upper}`).toBe(true);

      upper = first;
    }
  });
});
