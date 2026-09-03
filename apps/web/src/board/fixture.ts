import type { FracIdx, Rect, SceneStore, ShapeDraft, ShapeId, Style, Transform } from '@tessera/core';
import { createMemoryStore, idxBetween, transformBounds } from '@tessera/core';

/**
 * The seeded demo board.
 *
 * `/b/demo?seed=&n=` is the whole product in Phase 3: no store writes from the user, no
 * server, no persistence. It exists so a stranger can open a link and pan a board, and so the
 * pixel assertions in `3.C1` have something fixed to assert against.
 *
 * Deterministic from the seed alone. A shared link that renders a different board for each
 * visitor is not a shared link, and a pixel test against a random board is a flake waiting for
 * its turn — which this project has already paid for once, in D-5.
 */

/**
 * Most shapes the fixture will build, whatever the URL asks for.
 *
 * `n` arrives from a query string on a public URL, so it is untrusted input. 5,000 is what
 * this phase measures and roughly twice what the demo shows; a request for five million is a
 * tab that never finishes loading, served to anyone who types it.
 */
export const FIXTURE_MAX = 10_000;

/** Board extent the shapes are scattered across, in board units. */
const SPREAD = 6_000;
const MIN_SIZE = 24;
const MAX_SIZE = 180;

/**
 * A palette rather than random hues.
 *
 * Random colours produce mud and, worse, produce colours that a pixel assertion cannot
 * distinguish from the background. These are all far from white.
 */
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2'] as const;

/**
 * A minimal-standard Lehmer generator, seeded.
 *
 * Statistical quality is irrelevant; reproducibility is the entire requirement. `Math.random`
 * would make every visitor's board different and every pixel test a coin flip.
 */
const rng = (seed: number) => {
  let state = Math.abs(Math.trunc(seed)) % 2_147_483_647;
  if (state === 0) state = 1;
  return () => {
    state = (state * 16_807) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
};

/** Clamp an untrusted count from the query string to something a browser survives. */
const shapeCount = (requested: number): number => {
  if (!Number.isFinite(requested)) return 0;
  return Math.min(Math.max(Math.trunc(requested), 0), FIXTURE_MAX);
};

/**
 * Build the demo board.
 *
 * Writes through `SceneStore.gesture` like everything else — there is no back door into the
 * store, and a fixture that used one would be testing a path the app does not have.
 */
export const seededBoard = (seed: number, requested: number): SceneStore => {
  const store = createMemoryStore({ author: 'demo', now: () => 0 });
  const count = shapeCount(requested);
  if (count === 0) return store;

  const next = rng(seed);

  store.gesture((tx) => {
    let previous: FracIdx | undefined;
    for (let n = 0; n < count; n++) {
      const w = MIN_SIZE + next() * (MAX_SIZE - MIN_SIZE);
      const h = MIN_SIZE + next() * (MAX_SIZE - MIN_SIZE);
      const idx = idxBetween(previous, undefined, next);
      previous = idx;

      const draft: ShapeDraft = {
        id: `demo-${n}` as ShapeId,
        kind: 'rect',
        t: {
          x: next() * (SPREAD - w),
          y: next() * (SPREAD - h),
          w,
          h,
          // A quarter-turn at most. Rotation is in the fixture because a renderer that only
          // ever sees axis-aligned boxes never exercises the rotated-AABB path that culling
          // and hit testing both depend on.
          rot: (next() - 0.5) * (Math.PI / 2),
        } as unknown as Transform,
        idx,
        style: {
          fill: PALETTE[Math.floor(next() * PALETTE.length)] ?? PALETTE[0],
          stroke: '#0f172a',
          strokeWidth: 1.5,
          opacity: 1,
        } as unknown as Style,
      };

      tx.apply({ kind: 'create', draft });
    }
  });

  return store;
};

/**
 * The board's content bounds, for zoom-to-fit.
 *
 * Zeroes for an empty board rather than the `Infinity` an empty reduce produces —
 * `fitToContent` returns the default camera for degenerate content, and it can only do that if
 * it is handed a degenerate rect instead of an infinite one.
 */
export const boardBounds = (store: SceneStore): Rect => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const shape of store.drawOrder()) {
    const box = transformBounds(shape.t);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }

  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};
