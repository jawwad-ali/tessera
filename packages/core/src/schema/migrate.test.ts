import { describe as group, expect, it } from 'vitest';

import type { Quirk, RawShape, Shape, ShapeId } from './shape.ts';
import { MAX_TEXT_LENGTH } from './validate.ts';
import { resolveShape } from './migrate.ts';

/**
 * Reading a shape a peer sent.
 *
 * The describe name matches the verifier in PHASES.md (`-t resolveShape`).
 *
 * This is the untrusted-document boundary, and the reason validation lives at the *observer*
 * rather than at the write boundary: our own writes are already well-typed, and a hostile
 * peer skips our write path entirely. A `Y.Map` accepts `NaN`, `Infinity`, `undefined` as a
 * present key, a string in a numeric field and a 10 MB string — silently, and replicates
 * every one of them to every peer.
 *
 * So the requirement is totality, not rejection. One broken shape from one broken peer must
 * not become a blank board for everyone, which is why every row below still renders unless
 * there is genuinely nothing renderable left.
 */

const id = 's1' as ShapeId;

const GOOD_STYLE = { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 };
const GOOD_T = { x: 5, y: 20, w: 10, h: 10, rot: 0 };

/** A well-formed rect as it arrives from the document, with some fields replaced. */
const arriving = (patch: Readonly<Record<string, unknown>>): RawShape => ({
  id,
  v: 1,
  kind: 'rect',
  t: GOOD_T,
  idx: 'a0',
  style: GOOD_STYLE,
  author: 'peer',
  ...patch,
});

/** Expected quirks as `[key, reason]`, in the fixed key order the resolver reports them in. */
type ExpectedQuirk = readonly [Quirk['key'], Quirk['reason']];

interface Hazard {
  /** Named as the thing that happened on the wire, not as the branch it exercises. */
  readonly name: string;
  readonly raw: RawShape;
  readonly quirks: readonly ExpectedQuirk[];
  /** Asserted only when the row is expected to render. Absent means `shape` must be undefined. */
  readonly renders?: (shape: Shape) => void;
}

const HAZARDS: readonly Hazard[] = [
  {
    name: 'a NaN coordinate',
    raw: arriving({ t: { ...GOOD_T, x: NaN } }),
    quirks: [['t', 'not-finite']],
    renders: (shape) => {
      expect(shape.t.x).toBe(0);
      // Repairing one field must not discard the rest of the geometry.
      expect(shape.t.y).toBe(20);
      expect(shape.t.w).toBe(10);
    },
  },
  {
    name: 'an Infinity extent',
    raw: arriving({ t: { ...GOOD_T, w: Infinity } }),
    quirks: [['t', 'not-finite']],
    renders: (shape) => {
      expect(shape.t.w).toBe(0);
    },
  },
  {
    name: 'a coordinate past the range the bounds arithmetic survives',
    raw: arriving({ t: { ...GOOD_T, x: 1e308 } }),
    quirks: [['t', 'out-of-range']],
    renders: (shape) => {
      // The whole reason COORD_LIMIT exists: every field of {x: 1e308, w: 1.7e308} is finite
      // and the AABB derived from them is not, and `SpatialHash` throws on a non-finite bound.
      expect(shape.t.x).toBe(0);
    },
  },
  {
    name: 'a negative zero, which is legal and must survive untouched',
    raw: arriving({ t: { ...GOOD_T, rot: -0 } }),
    quirks: [],
    renders: (shape) => {
      // Not normalised at read time — the encoder does that. A guard written as
      // `value > 0 || value < 0` would call this a fault and repair a correct shape.
      expect(Object.is(shape.t.rot, -0)).toBe(true);
    },
  },
  {
    name: 'a string where a number belongs',
    raw: arriving({ t: { ...GOOD_T, y: 'banana' } }),
    quirks: [['t', 'wrong-type']],
    renders: (shape) => {
      expect(shape.t.y).toBe(0);
      expect(shape.t.x).toBe(5);
    },
  },
  {
    name: 'undefined sitting in a key that is present',
    raw: arriving({ v: undefined }),
    quirks: [['v', 'missing']],
    renders: (shape) => {
      expect(shape.v).toBe(1);
    },
  },
  {
    name: 'a version from a client newer than this one',
    raw: arriving({ v: 2 }),
    quirks: [['v', 'out-of-range']],
    renders: (shape) => {
      // Read anyway. Additive-only migration means an unfamiliar version is still readable,
      // and refusing it would blank a board every time anyone deploys.
      expect(shape.v).toBe(1);
    },
  },
  {
    name: 'the empty object a peer Date arrives as',
    raw: arriving({ style: {} }),
    quirks: [['style', 'missing']],
    renders: (shape) => {
      // A Date is type-identical in TypeScript and arrives at every other replica as an
      // empty object, so this is what the observer actually has to cope with.
      expect(shape.style.fill).toBe('#000000');
      expect(shape.style.opacity).toBe(1);
    },
  },
  {
    name: 'a 10 MB string',
    raw: arriving({ author: 'a'.repeat(10_000_000) }),
    quirks: [['author', 'too-long']],
    renders: (shape) => {
      expect(shape.author.length).toBe(MAX_TEXT_LENGTH);
    },
  },
  {
    name: 'a missing draw-order index',
    raw: arriving({ idx: undefined }),
    quirks: [['idx', 'missing']],
    renders: (shape) => {
      // A constant, not a generated key: the resolver is pure, so it has neither an rng nor
      // the neighbours to place one between. Every replica repairs to the same index and the
      // `id` tie-break orders them identically, which is the property that matters.
      expect(shape.idx).toBe('a0');
    },
  },
  {
    name: 'a kind no version of this app has ever written',
    raw: arriving({ kind: 'triangle' }),
    quirks: [['kind', 'unknown-kind']],
  },
  {
    name: 'geometry that is not an object at all',
    raw: arriving({ t: 'banana' }),
    quirks: [['t', 'wrong-type']],
  },
  {
    name: 'no geometry key at all',
    raw: { id, v: 1, kind: 'rect', idx: 'a0', style: GOOD_STYLE, author: 'peer' },
    quirks: [['t', 'missing']],
  },
  {
    name: 'a pen stroke whose ink did not survive',
    raw: arriving({ kind: 'pen', ink: { q: 0.5, d: 42, n: 100 } }),
    quirks: [['ink', 'wrong-type']],
  },
  {
    name: 'a pen stroke with no ink key',
    raw: arriving({ kind: 'pen' }),
    quirks: [['ink', 'missing']],
  },
  {
    name: 'two separate faults in one record',
    raw: arriving({ t: { ...GOOD_T, x: NaN, y: 'banana' }, idx: '' }),
    quirks: [
      ['t', 'not-finite'],
      ['t', 'wrong-type'],
      ['idx', 'missing'],
    ],
    renders: (shape) => {
      expect(shape.t.x).toBe(0);
      expect(shape.t.y).toBe(0);
      expect(shape.idx).toBe('a0');
    },
  },
  {
    name: 'nothing wrong at all',
    raw: arriving({}),
    quirks: [],
    renders: (shape) => {
      expect(shape.t).toEqual(GOOD_T);
      expect(shape.style).toEqual(GOOD_STYLE);
      expect(shape.author).toBe('peer');
      expect(shape.kind).toBe('rect');
    },
  },
  {
    name: 'nothing wrong at all, on a pen stroke',
    raw: arriving({ kind: 'pen', ink: { q: 0.5, d: 'AAEC', n: 3 } }),
    quirks: [],
    renders: (shape) => {
      expect(shape.kind).toBe('pen');
      expect(shape.kind === 'pen' ? shape.ink.n : undefined).toBe(3);
    },
  },
];

group('resolveShape', () => {
  it('never throws, for any hazard in the table', () => {
    // Totality stated on its own, because it is the one property whose failure mode is a
    // blank board for everyone rather than one wrong shape.
    for (const hazard of HAZARDS) {
      expect(() => resolveShape(id, hazard.raw), hazard.name).not.toThrow();
    }
  });

  HAZARDS.forEach((hazard) => {
    it(`absorbs ${hazard.name}`, () => {
      const resolved = resolveShape(id, hazard.raw);

      expect(resolved.quirks.map((quirk) => [quirk.key, quirk.reason])).toEqual(hazard.quirks);
      expect(resolved.quirks.every((quirk) => quirk.id === id)).toBe(true);

      if (hazard.renders === undefined) {
        // `shape` is undefined only when there is nothing renderable left: no usable kind,
        // no usable geometry, or a pen stroke whose points cannot be recovered. Everything
        // else is repaired, because a shape that renders slightly wrong beats a hole.
        expect(resolved.shape).toBeUndefined();
        return;
      }

      expect(resolved.shape).toBeDefined();
      if (resolved.shape !== undefined) hazard.renders(resolved.shape);
    });
  });
});
