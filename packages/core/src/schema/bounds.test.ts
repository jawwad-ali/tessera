import fc from 'fast-check';
import { describe as group, expect, it } from 'vitest';

import { rectContains, type Vec2 } from '../camera/camera.ts';
import { COORD_LIMIT, shapeCorners, transformBounds } from './bounds.ts';
import type { Transform } from './shape.ts';

/**
 * Whether a shape is on screen, and whether you can click it.
 *
 * Bounds feed the spatial index, which drives both culling and the first tier of hit
 * testing. Bounds that are too small drop a visible shape mid-pan and make it unclickable;
 * bounds that are far too large defeat the point of culling. Rotation is where this is
 * normally got wrong: a 90-degree-rotated wide rectangle is a *tall* box, and code that
 * ignores rotation returns the unrotated one.
 */

const t = (x: number, y: number, w: number, h: number, rot = 0): Transform =>
  ({ x, y, w, h, rot }) as unknown as Transform;

const finite = () => fc.double({ min: -5000, max: 5000, noNaN: true, noDefaultInfinity: true });
const extent = () => fc.double({ min: 0, max: 2000, noNaN: true, noDefaultInfinity: true });

group('an unrotated shape occupies exactly its own rectangle', () => {
  it('does not inflate the common case', () => {
    // Every shape a user draws starts unrotated, so an inflated box here would make culling
    // and hit testing worse for the overwhelming majority of shapes.
    expect(transformBounds(t(10, 20, 80, 60))).toEqual({ x: 10, y: 20, w: 80, h: 60 });
  });
});

group('a rotated shape is still found where it visibly is', () => {
  it('a quarter-turned wide rectangle becomes a tall box', () => {
    // The canonical failure: ignore rotation and this returns 200x50, so the shape vanishes
    // from a cull the moment it leaves that box.
    const bounds = transformBounds(t(0, 0, 200, 50, Math.PI / 2));

    expect(bounds.w).toBeCloseTo(50, 6);
    expect(bounds.h).toBeCloseTo(200, 6);
    // Rotation is about the shape's centre, so the centre does not move.
    expect(bounds.x + bounds.w / 2).toBeCloseTo(100, 6);
    expect(bounds.y + bounds.h / 2).toBeCloseTo(25, 6);
  });

  it('a 45-degree square grows by root two', () => {
    const bounds = transformBounds(t(0, 0, 100, 100, Math.PI / 4));

    expect(bounds.w).toBeCloseTo(100 * Math.SQRT2, 6);
    expect(bounds.h).toBeCloseTo(100 * Math.SQRT2, 6);
  });

  it('contains every corner of the shape, at any angle', () => {
    // The property that actually matters. If a corner falls outside the bounds, the spatial
    // index can return no candidate for a pointer that is visibly over the shape.
    //
    // Compared with a relative epsilon, deliberately. `transformBounds` derives the box from
    // half-extent projections while `shapeCorners` rotates each corner — the same geometry by
    // two different float routes, so they disagree in the last bits exactly at the boundary.
    // fast-check found this immediately with denormal inputs (x=3.3e-251, rot=-4.3e-146).
    // Bit-equality at the edge is not a property worth asserting; containment is.
    const containsWithSlack = (bounds: ReturnType<typeof transformBounds>, corner: Vec2): boolean => {
      const slack = 1e-9 * Math.max(1, Math.abs(corner.x), Math.abs(corner.y), bounds.w, bounds.h);
      return rectContains(
        { x: bounds.x - slack, y: bounds.y - slack, w: bounds.w + slack * 2, h: bounds.h + slack * 2 },
        corner,
      );
    };

    fc.assert(
      fc.property(
        finite(),
        finite(),
        extent(),
        extent(),
        fc.double({ min: -Math.PI * 4, max: Math.PI * 4, noNaN: true, noDefaultInfinity: true }),
        (x, y, w, h, rot) => {
          const transform = t(x, y, w, h, rot);
          const bounds = transformBounds(transform);
          return shapeCorners(transform).every((corner) => containsWithSlack(bounds, corner));
        },
      ),
      { numRuns: 500 },
    );
  });

  it('is never smaller than the unrotated shape in area', () => {
    // A rotated AABB can only grow. Shrinking would mean the maths lost a term.
    fc.assert(
      fc.property(
        extent(),
        extent(),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true, noDefaultInfinity: true }),
        (w, h, rot) => {
          const bounds = transformBounds(t(0, 0, w, h, rot));
          return bounds.w >= Math.min(w, h) - 1e-9 && bounds.h >= Math.min(w, h) - 1e-9;
        },
      ),
      { numRuns: 300 },
    );
  });
});

group('degenerate shapes still produce usable bounds', () => {
  it('handles a zero-area shape', () => {
    // A pen stroke that is a single dot, or a line with no height.
    expect(transformBounds(t(5, 5, 0, 0))).toEqual({ x: 5, y: 5, w: 0, h: 0 });
    expect(transformBounds(t(0, 0, 100, 0)).h).toBeCloseTo(0, 6);
  });

  it('returns finite bounds for every in-range transform', () => {
    // The spatial index refuses non-finite bounds by throwing, so producing one here turns a
    // bad shape into a crash on insert.
    //
    // Scoped to COORD_LIMIT deliberately, and that scope is the point. An earlier version of
    // this test claimed `transformBounds` "never returns a non-finite bound" and passed only
    // because its generator capped extents at 2000. It does not hold in general - see the
    // next test - so the honest guarantee is conditional, and the condition is a constant the
    // resolver can enforce.
    fc.assert(
      fc.property(
        fc.oneof(finite(), fc.constant(COORD_LIMIT), fc.constant(-COORD_LIMIT)),
        fc.oneof(finite(), fc.constant(COORD_LIMIT), fc.constant(-COORD_LIMIT)),
        fc.oneof(extent(), fc.constant(COORD_LIMIT)),
        fc.oneof(extent(), fc.constant(COORD_LIMIT)),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true, noDefaultInfinity: true }),
        (x, y, w, h, rot) => {
          const bounds = transformBounds(t(x, y, w, h, rot));
          return (
            Number.isFinite(bounds.x) &&
            Number.isFinite(bounds.y) &&
            Number.isFinite(bounds.w) &&
            Number.isFinite(bounds.h)
          );
        },
      ),
      { numRuns: 400 },
    );
  });

  it('overflows above COORD_LIMIT, which is why the resolver must range-check', () => {
    // Recorded as a test rather than a comment, because it is the reason COORD_LIMIT exists
    // and the reason `Finite` is not a sufficient guard. Every field below is finite and
    // satisfies the `Finite` brand; the derived Rect is not, and `SpatialHash.set` throws on
    // exactly that - so a hostile-but-finite shape from a peer would crash the insert.
    //
    // The fix belongs at the observer boundary (a range check in the resolver), not here:
    // clamping inside `transformBounds` would hide the bad shape instead of reporting it as
    // a Quirk, and every consumer would inherit a silent lie about the shape's size.
    const huge = t(1e308, 0, 1.7e308, 1.7e308, 0.785);
    expect([1e308, 0, 1.7e308, 1.7e308, 0.785].every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(transformBounds(huge).w)).toBe(false);
  });
});
