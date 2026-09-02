import fc from 'fast-check';
import { describe as group, expect, it } from 'vitest';

import { rectsIntersect, type Rect } from '../camera/camera.ts';
import { SpatialHash, buildSpatialHash, type Bounded } from './spatial-hash.ts';

/**
 * The index is a performance structure whose only correctness obligation is **no false
 * negatives**: a cull that drops a visible shape is a rendering bug users see, while a few
 * extra candidates are invisible. So the central test is differential — the index against a
 * brute-force scan — rather than a set of hand-picked rectangles, which would never
 * generate the cases that matter: a shape exactly on a cell boundary, a zero-area shape, a
 * shape at negative coordinates, or one large enough to be reclassified as oversized.
 */

const coord = () => fc.double({ min: -5000, max: 5000, noNaN: true, noDefaultInfinity: true });
const extent = () => fc.double({ min: 0, max: 1200, noNaN: true, noDefaultInfinity: true });

const rect = (): fc.Arbitrary<Rect> =>
  fc.record({ x: coord(), y: coord(), w: extent(), h: extent() });

/**
 * Items with distinct ids. `fc.uniqueArray` on the id is what makes the differential test
 * meaningful — duplicate ids would mean the brute-force reference and the index disagree
 * about what "an item" is, and the failure would look like an index bug.
 */
const items = (maxLength = 60): fc.Arbitrary<Bounded[]> =>
  fc.uniqueArray(
    fc.record({ id: fc.string({ minLength: 1, maxLength: 6 }), bounds: rect() }),
    { maxLength, selector: (item) => item.id },
  );

/** The reference implementation: an O(n) scan, which is what the index has to agree with. */
function bruteForce(all: readonly Bounded[], query: Rect): Set<string> {
  const found = new Set<string>();
  for (const item of all) if (rectsIntersect(item.bounds, query)) found.add(item.id);
  return found;
}

group('query is a superset — the only property a cull needs', () => {
  it('never misses an intersecting item', () => {
    fc.assert(
      fc.property(items(), rect(), (all, query) => {
        const index = buildSpatialHash(all);
        const candidates = new Set(index.query(query));
        for (const id of bruteForce(all, query)) {
          if (!candidates.has(id)) return false;
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('queryExact agrees with the brute-force scan exactly', () => {
    fc.assert(
      fc.property(items(), rect(), (all, query) => {
        const index = buildSpatialHash(all);
        const exact = new Set(index.queryExact(query));
        const expected = bruteForce(all, query);
        expect([...exact].sort()).toEqual([...expected].sort());
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('agrees regardless of cell size', () => {
    // Metamorphic: cell size is a tuning parameter, so it must not be observable in the
    // results. If it is, something is being filed by a rule the query does not mirror.
    fc.assert(
      fc.property(items(30), rect(), fc.constantFrom(8, 64, 256, 4096), (all, query, cellSize) => {
        const tuned = buildSpatialHash(all, { cellSize });
        const reference = buildSpatialHash(all, { cellSize: 256 });
        expect([...tuned.queryExact(query)].sort()).toEqual(
          [...reference.queryExact(query)].sort(),
        );
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('finds oversized items, which bypass the grid entirely', () => {
    // A board-sized frame shape would otherwise be filed into tens of thousands of cells,
    // so it goes in a linearly-scanned list — and must still be found.
    const index = new SpatialHash({ cellSize: 16, maxCellsPerItem: 4 });
    const huge: Rect = { x: -10_000, y: -10_000, w: 20_000, h: 20_000 };
    index.set('frame', huge);
    expect(index.oversizedCount).toBe(1);
    expect(index.query({ x: 0, y: 0, w: 1, h: 1 })).toContain('frame');
    expect(index.query({ x: 5000, y: -5000, w: 1, h: 1 })).toContain('frame');
    // And not found where it genuinely is not.
    expect(index.queryExact({ x: 50_000, y: 50_000, w: 1, h: 1 })).toEqual([]);
  });
});

group('moving items — the hot path', () => {
  it('reflects the new position and forgets the old one', () => {
    // This is what a drag commit does on every shape in the selection, so a stale cell entry
    // here shows up as a shape you cannot click where it is, and can click where it was.
    fc.assert(
      fc.property(items(20), rect(), rect(), (all, moveTo, query) => {
        if (all.length === 0) return true;
        const index = buildSpatialHash(all);
        const first = all[0];
        if (!first) return true;

        index.set(first.id, moveTo);
        const moved: Bounded[] = [{ id: first.id, bounds: moveTo }, ...all.slice(1)];

        expect([...index.queryExact(query)].sort()).toEqual([...bruteForce(moved, query)].sort());
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('survives a shape moving between grid and oversized classification', () => {
    // The classification boundary is the interesting case: file it in the grid, grow it into
    // the oversized list, shrink it back. A leak in either direction leaves a ghost.
    const index = new SpatialHash({ cellSize: 32, maxCellsPerItem: 4 });
    const small: Rect = { x: 0, y: 0, w: 10, h: 10 };
    const huge: Rect = { x: 0, y: 0, w: 5000, h: 5000 };

    index.set('s', small);
    expect(index.oversizedCount).toBe(0);

    index.set('s', huge);
    expect(index.oversizedCount).toBe(1);
    expect(index.queryExact({ x: 4000, y: 4000, w: 1, h: 1 })).toEqual(['s']);

    index.set('s', small);
    expect(index.oversizedCount).toBe(0);
    expect(index.queryExact({ x: 4000, y: 4000, w: 1, h: 1 })).toEqual([]);
    expect(index.queryExact({ x: 5, y: 5, w: 1, h: 1 })).toEqual(['s']);
  });

  it('re-setting identical bounds is a no-op', () => {
    const index = new SpatialHash();
    index.set('a', { x: 0, y: 0, w: 10, h: 10 });
    const cellsBefore = index.cellCount;
    index.set('a', { x: 0, y: 0, w: 10, h: 10 });
    expect(index.cellCount).toBe(cellsBefore);
    expect(index.size).toBe(1);
  });
});

group('removal leaks nothing', () => {
  it('deleting everything empties the grid completely', () => {
    // Without reclaiming empty buckets, a board panned across for an hour retains a cell for
    // every position anything ever occupied — a slow leak that looks like a memory bug in
    // the renderer.
    fc.assert(
      fc.property(items(), (all) => {
        const index = buildSpatialHash(all);
        for (const item of all) expect(index.delete(item.id)).toBe(true);
        expect(index.size).toBe(0);
        expect(index.cellCount).toBe(0);
        expect(index.oversizedCount).toBe(0);
        expect(index.query({ x: -1e6, y: -1e6, w: 2e6, h: 2e6 })).toEqual([]);
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('deleting an absent id is false, not an error', () => {
    const index = new SpatialHash();
    expect(index.delete('nope')).toBe(false);
  });

  it('clear empties everything', () => {
    const index = buildSpatialHash([
      { id: 'a', bounds: { x: 0, y: 0, w: 10, h: 10 } },
      { id: 'big', bounds: { x: 0, y: 0, w: 1e6, h: 1e6 } },
    ]);
    index.clear();
    expect(index.size).toBe(0);
    expect(index.cellCount).toBe(0);
    expect(index.oversizedCount).toBe(0);
  });
});

group('degenerate geometry', () => {
  it('handles zero-area shapes and shapes on cell boundaries', () => {
    const index = new SpatialHash({ cellSize: 100 });
    // Exactly on a boundary: the classic off-by-one in a grid index.
    index.set('corner', { x: 100, y: 100, w: 0, h: 0 });
    expect(index.queryExact({ x: 100, y: 100, w: 0, h: 0 })).toEqual(['corner']);
    expect(index.queryExact({ x: 90, y: 90, w: 20, h: 20 })).toEqual(['corner']);
    // Edge-inclusive, matching rectsIntersect.
    expect(index.queryExact({ x: 0, y: 0, w: 100, h: 100 })).toEqual(['corner']);
  });

  it('normalises a query rect with negative extents', () => {
    // A marquee dragged up and to the left produces exactly this, and a grid that computes
    // max < min silently matches nothing — a selection box that works in two directions only.
    const index = new SpatialHash();
    index.set('a', { x: 50, y: 50, w: 10, h: 10 });
    expect(index.queryExact({ x: 100, y: 100, w: -100, h: -100 })).toEqual(['a']);
  });

  it('handles negative coordinates', () => {
    fc.assert(
      fc.property(rect(), (query) => {
        const all: Bounded[] = [
          { id: 'nw', bounds: { x: -3000, y: -3000, w: 100, h: 100 } },
          { id: 'origin', bounds: { x: -5, y: -5, w: 10, h: 10 } },
          { id: 'se', bounds: { x: 2000, y: 2000, w: 50, h: 50 } },
        ];
        const index = buildSpatialHash(all);
        expect([...index.queryExact(query)].sort()).toEqual([...bruteForce(all, query)].sort());
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('refuses non-finite bounds instead of filing them unreachably', () => {
    // A NaN bound produces a NaN cell key and files the shape where no query can reach it.
    // The CRDT accepts NaN silently and propagates it to every replica (measured), so this
    // is the layer where that stops being invisible.
    const index = new SpatialHash();
    expect(() => {
      index.set('bad', { x: Number.NaN, y: 0, w: 10, h: 10 });
    }).toThrow(/not finite/);
    expect(() => {
      index.set('bad', { x: 0, y: 0, w: Number.POSITIVE_INFINITY, h: 10 });
    }).toThrow(/not finite/);
    expect(index.size).toBe(0);
  });

  it('rejects a nonsensical cell size at construction', () => {
    expect(() => new SpatialHash({ cellSize: 0 })).toThrow(RangeError);
    expect(() => new SpatialHash({ cellSize: -1 })).toThrow(RangeError);
    expect(() => new SpatialHash({ cellSize: Number.NaN })).toThrow(RangeError);
  });
});

group('queryPoint', () => {
  it('finds a shape under the pointer, and slop widens the probe', () => {
    const index = new SpatialHash();
    index.set('line', { x: 100, y: 100, w: 200, h: 0 }); // a hairline

    expect(index.queryExact({ x: 150, y: 100, w: 0, h: 0 })).toEqual(['line']);
    // Two board units away: missed without slop, found with it. This is why hit slop has to
    // be converted from screen space, or a hairline is unclickable when zoomed out.
    //
    // Note the EXACT variant. `queryPoint` returns candidates by contract, and the shape
    // shares a grid cell with the probe, so it legitimately appears there — asserting
    // absence against the candidate query was a bad assumption in an earlier version of
    // this test, and the suite caught it.
    expect(index.queryPointExact(150, 102)).toEqual([]);
    expect(index.queryPointExact(150, 102, 5)).toContain('line');
    // The candidate query is allowed to be a superset, and is.
    expect(index.queryPoint(150, 102)).toContain('line');
  });
});

group('bookkeeping', () => {
  it('tracks size and exposes filed bounds', () => {
    const index = new SpatialHash();
    const bounds: Rect = { x: 1, y: 2, w: 3, h: 4 };
    index.set('a', bounds);
    expect(index.size).toBe(1);
    expect(index.has('a')).toBe(true);
    expect(index.boundsOf('a')).toEqual(bounds);
    expect(index.boundsOf('missing')).toBeUndefined();
  });

  it('cell count stays proportional to content, not to history', () => {
    const index = new SpatialHash({ cellSize: 100 });
    // Walk one shape across 500 cells, as a long pan-and-drag would.
    for (let i = 0; i < 500; i++) index.set('walker', { x: i * 100, y: 0, w: 10, h: 10 });
    expect(index.size).toBe(1);
    // One shape occupies one or two cells no matter how far it has travelled.
    expect(index.cellCount).toBeLessThanOrEqual(2);
  });
});
