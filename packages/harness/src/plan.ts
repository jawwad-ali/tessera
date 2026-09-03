import fc from 'fast-check';

import type { Command, Rng } from '@tessera/core';
import type { FracIdx, PackedInk, Shape, ShapeDraft, ShapeId, Style, Transform } from '@tessera/core';
import { idxBetween } from '@tessera/core';

/**
 * Generated gestures over the real command vocabulary.
 *
 * The problem this file exists to solve is the one Phase 2 named in advance: a generator that
 * mostly trips `RejectReason` tests nothing. Generating `ShapeId`s directly is exactly how
 * that happens — a random id names a shape that is not there, the command is refused, and the
 * run asserts that refusal works rather than that anything else does.
 *
 * So nothing here generates an id. An action carries a **positional selector**: a
 * non-negative integer resolved against the live draw order at execution time, modulo its
 * length. Every action therefore names a shape that exists, and the wasted fraction the suite
 * enforces stays down at the unavoidable case — the opening actions of a plan, when there is
 * nothing on the board yet to pick.
 *
 * The actions are named after what a user did, not after the command they emit, because that
 * is what makes a shrunk counterexample readable: `draw, drag, restackTogether` is a bug
 * report, and a list of `Command` objects is a puzzle.
 */

/** Board coordinate range. Wide enough to be interesting, small enough to collide often. */
const COORD = { min: -2_000, max: 2_000, noNaN: true } as const;
const EXTENT = { min: 1, max: 400, noNaN: true } as const;

/** From PHASES.md's pre-registered bounds. */
export const MAX_SHAPES = 40;
export const MAX_ACTIONS = 24;

export type Action =
  /** Draws a rectangle or finishes a freehand stroke. */
  | {
      readonly kind: 'draw';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly rot: number;
      readonly pen: boolean;
    }
  /** Drags one shape across `frames` pointermove events. */
  | { readonly kind: 'drag'; readonly pick: number; readonly x: number; readonly y: number; readonly frames: number }
  /** Marquee-selects several and drags them together — one command per frame, several entries. */
  | { readonly kind: 'dragMany'; readonly picks: readonly number[]; readonly x: number; readonly y: number }
  /** Picks a shape up, moves it, and drops it back where it started. */
  | { readonly kind: 'cancelDrag'; readonly pick: number }
  /** Recolours a shape. */
  | { readonly kind: 'recolour'; readonly pick: number; readonly fill: number }
  /** Sends one shape to a gap in the draw order. */
  | { readonly kind: 'restack'; readonly pick: number; readonly gap: number }
  /**
   * Sends **two** shapes to the *same* gap, both indices generated from the same neighbours.
   *
   * This is the single-replica model of the case jittered indexing exists for: two clients
   * each resolve "send to back" against the same snapshot and, without jitter, generate the
   * *identical* key. Modelling it here rather than waiting for N replicas in Phase 8 is what
   * lets this phase carry the unjittered-index mutant `2.C2` asks for.
   */
  | { readonly kind: 'restackTogether'; readonly picks: readonly [number, number]; readonly gap: number }
  /** Deletes one or more shapes. */
  | { readonly kind: 'erase'; readonly picks: readonly number[] };

export interface Plan {
  readonly actions: readonly Action[];
  /** Seeds the index jitter, so a failing plan reproduces exactly. */
  readonly rngSeed: number;
}

const pick = fc.nat({ max: 1_000 });
const coord = fc.double(COORD);

const drawAction = fc.record({
  kind: fc.constant('draw' as const),
  x: coord,
  y: coord,
  w: fc.double(EXTENT),
  h: fc.double(EXTENT),
  // Includes a full turn, so `-0` reaches the encoder through ordinary arithmetic.
  rot: fc.double({ min: -Math.PI * 2, max: Math.PI * 2, noNaN: true }),
  pen: fc.boolean(),
});

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  { arbitrary: drawAction, weight: 4 },
  {
    arbitrary: fc.record({
      kind: fc.constant('drag' as const),
      pick,
      x: coord,
      y: coord,
      frames: fc.integer({ min: 1, max: 300 }),
    }),
    weight: 4,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('dragMany' as const),
      picks: fc.array(pick, { minLength: 2, maxLength: 5 }),
      x: coord,
      y: coord,
    }),
    weight: 2,
  },
  { arbitrary: fc.record({ kind: fc.constant('cancelDrag' as const), pick }), weight: 1 },
  {
    arbitrary: fc.record({ kind: fc.constant('recolour' as const), pick, fill: fc.nat({ max: 0xffffff }) }),
    weight: 2,
  },
  { arbitrary: fc.record({ kind: fc.constant('restack' as const), pick, gap: pick }), weight: 3 },
  {
    arbitrary: fc.record({
      kind: fc.constant('restackTogether' as const),
      picks: fc.tuple(pick, pick),
      gap: pick,
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('erase' as const),
      picks: fc.array(pick, { minLength: 1, maxLength: 3 }),
    }),
    weight: 1,
  },
);

/** Opening draws, so the rest of the plan has something to act on. */
const OPENING_DRAWS = 3;

/**
 * A plan: a few opening draws, then anything.
 *
 * The opening draws are not a convenience. Measured over 500 plans of the first generator,
 * **399 skipped their very first action** and every skip of a drag, restack, erase, recolour
 * or cancel happened on an empty board — 52% of all actions wasted, against a 30% ceiling.
 * That waste was real rather than a measurement artefact: an empty board genuinely has nothing
 * to drag, so the fix is to stop generating sessions that spend most of their life empty. A
 * user opens a board and draws something; this is that.
 *
 * Total length stays inside the pre-registered 1–24 bound: at most 3 opening draws plus at
 * most 21 free actions.
 */
export const planArb: fc.Arbitrary<Plan> = fc
  .tuple(
    fc.array(drawAction, { minLength: 1, maxLength: OPENING_DRAWS }),
    fc.array(actionArb, { minLength: 1, maxLength: MAX_ACTIONS - OPENING_DRAWS }),
    fc.integer({ min: 1, max: 2 ** 31 - 2 }),
  )
  .map(([opening, rest, rngSeed]) => ({ actions: [...opening, ...rest], rngSeed }));

/**
 * A seeded generator, because `Math.random` is banned in `core` for exactly this reason: a
 * failing plan has to reproduce, and a hidden clock or ambient entropy makes that impossible.
 *
 * A minimal-standard Lehmer generator. Its statistical quality is irrelevant here — what
 * matters is that the same seed gives the same jitter, so a shrunk counterexample stays a
 * counterexample.
 */
export const seededRng = (seed: number): Rng => {
  let state = seed % 2_147_483_647;
  if (state <= 0) state += 2_147_483_646;
  return () => {
    state = (state * 16_807) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
};

const hex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;

/** The brands are phantom; these are the two places this file mints one. */
const asTransform = (x: number, y: number, w: number, h: number, rot: number): Transform =>
  ({ x, y, w, h, rot }) as unknown as Transform;
const asStyle = (fill: string): Style =>
  ({ fill, stroke: '#000000', strokeWidth: 1, opacity: 1 }) as unknown as Style;

/** What one action turned into, so the suite can count what was wasted. */
export interface Emitted {
  readonly commands: readonly Command[];
  /** True when the scene had nothing to pick and the action could not be expressed at all. */
  readonly skipped: boolean;
}

const NOTHING: Emitted = { commands: [], skipped: true };

const at = (order: readonly Shape[], selector: number): Shape | undefined =>
  order.length === 0 ? undefined : order[selector % order.length];

/**
 * Distinct shapes for a multi-select, since the same shape twice is not a group.
 *
 * Tops up from the shapes next along when the selectors collide. Without that a multi-select
 * is skipped whenever two selectors land on the same shape, which on a small board is most of
 * the time — measured at 112 wasted `restackTogether` actions on *non-empty* boards over 500
 * plans, the second largest source of waste after the empty board itself.
 *
 * It is also the truer model: a marquee selects whatever is inside it, so a selector picks
 * where the box starts rather than naming each shape in it.
 */
const several = (order: readonly Shape[], selectors: readonly number[], want: number): readonly Shape[] => {
  const chosen = new Map<ShapeId, Shape>();
  for (const selector of selectors) {
    const shape = at(order, selector);
    if (shape !== undefined) chosen.set(shape.id, shape);
  }

  if (chosen.size < want && order.length >= want) {
    const start = (selectors[0] ?? 0) % order.length;
    for (let step = 0; step < order.length && chosen.size < want; step++) {
      const shape = order[(start + step) % order.length]!;
      chosen.set(shape.id, shape);
    }
  }

  return [...chosen.values()];
};

/**
 * The index of the `gap`th slot in the draw order, jittered.
 *
 * Walks the upper neighbour forward past any shape tied with the lower one. Two shapes sharing
 * an index leave no gap between them, so `idxBetween` refuses — and a real interaction layer
 * has to widen exactly like this rather than crash. Without it the suite reports a *crash*
 * where the interesting signal is an *invariant*, which is the difference between "something
 * broke" and "two shapes were given the same position".
 */
const gapIndex = (order: readonly Shape[], gap: number, rng: Rng): FracIdx => {
  const below = order[gap - 1]?.idx;
  let above = gap;
  while (above < order.length && order[above]?.idx === below) above += 1;
  return idxBetween(below, order[above]?.idx, rng);
};

/**
 * Turn one action into the commands it emits, against the scene as it stands.
 *
 * `nextId` is injected rather than generated: ids have to be unique across a plan and the
 * generator has no memory, so the suite owns the counter.
 */
export const emit = (
  action: Action,
  order: readonly Shape[],
  nextId: () => ShapeId,
  rng: Rng,
): Emitted => {
  switch (action.kind) {
    case 'draw': {
      if (order.length >= MAX_SHAPES) return NOTHING;
      const last = order[order.length - 1];
      const draft: ShapeDraft = action.pen
        ? {
            id: nextId(),
            kind: 'pen',
            t: asTransform(action.x, action.y, action.w, action.h, action.rot),
            idx: idxBetween(last?.idx, undefined, rng),
            style: asStyle('#000000'),
            ink: { q: 0.5, d: 'AAEC', n: 3 } as unknown as PackedInk,
          }
        : {
            id: nextId(),
            kind: 'rect',
            t: asTransform(action.x, action.y, action.w, action.h, action.rot),
            idx: idxBetween(last?.idx, undefined, rng),
            style: asStyle('#ffffff'),
          };
      return { commands: [{ kind: 'create', draft }], skipped: false };
    }

    case 'drag': {
      const shape = at(order, action.pick);
      if (shape === undefined) return NOTHING;
      const commands: Command[] = [];
      // Every frame carries the whole geometry. A delta would be a read-modify-write, which
      // is the lost-update pattern this project exists to talk about.
      for (let frame = 1; frame <= action.frames; frame++) {
        const ratio = frame / action.frames;
        commands.push({
          kind: 'transform',
          entries: [
            {
              id: shape.id,
              t: asTransform(
                shape.t.x + (action.x - shape.t.x) * ratio,
                shape.t.y + (action.y - shape.t.y) * ratio,
                shape.t.w,
                shape.t.h,
                shape.t.rot,
              ),
            },
          ],
        });
      }
      return { commands, skipped: false };
    }

    case 'dragMany': {
      const chosen = several(order, action.picks, 2);
      if (chosen.length < 2) return NOTHING;
      return {
        commands: [
          {
            kind: 'transform',
            entries: chosen.map((shape) => ({
              id: shape.id,
              t: asTransform(action.x, action.y, shape.t.w, shape.t.h, shape.t.rot),
            })) as [{ id: ShapeId; t: Transform }, ...{ id: ShapeId; t: Transform }[]],
          },
        ],
        skipped: false,
      };
    }

    case 'cancelDrag': {
      const shape = at(order, action.pick);
      if (shape === undefined) return NOTHING;
      // Out and back. Effective, not wasted: the write it must *not* produce is the point.
      return {
        commands: [
          { kind: 'transform', entries: [{ id: shape.id, t: asTransform(0, 0, shape.t.w, shape.t.h, shape.t.rot) }] },
          { kind: 'transform', entries: [{ id: shape.id, t: shape.t }] },
        ],
        skipped: false,
      };
    }

    case 'recolour': {
      const shape = at(order, action.pick);
      if (shape === undefined) return NOTHING;
      return {
        commands: [{ kind: 'restyle', entries: [{ id: shape.id, style: asStyle(hex(action.fill)) }] }],
        skipped: false,
      };
    }

    case 'restack': {
      const shape = at(order, action.pick);
      if (shape === undefined) return NOTHING;
      const gap = action.gap % (order.length + 1);
      return {
        commands: [{ kind: 'reorder', entries: [{ id: shape.id, idx: gapIndex(order, gap, rng) }] }],
        skipped: false,
      };
    }

    case 'restackTogether': {
      const chosen = several(order, action.picks, 2);
      if (chosen.length < 2) return NOTHING;
      const gap = action.gap % (order.length + 1);
      // Both indices from the SAME neighbours, deliberately. Two clients resolving the same
      // "send to back" against the same snapshot is what jitter exists to keep distinct.
      const first = gapIndex(order, gap, rng);
      const second = gapIndex(order, gap, rng);
      return {
        commands: [
          {
            kind: 'reorder',
            entries: [
              { id: chosen[0]!.id, idx: first },
              { id: chosen[1]!.id, idx: second },
            ],
          },
        ],
        skipped: false,
      };
    }

    case 'erase': {
      const chosen = several(order, action.picks, 1);
      if (chosen.length === 0) return NOTHING;
      return {
        commands: [{ kind: 'delete', ids: chosen.map((shape) => shape.id) as [ShapeId, ...ShapeId[]] }],
        skipped: false,
      };
    }
  }
};
