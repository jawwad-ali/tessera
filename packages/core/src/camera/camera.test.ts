import fc from 'fast-check';
import { describe as group, expect, it } from 'vitest';

import {
  DEFAULT_CAMERA,
  MAX_ZOOM,
  MIN_ZOOM,
  applyMatrix,
  cameraEquals,
  clampZoom,
  deviceMatrix,
  fitToContent,
  invert,
  panByScreen,
  rectContains,
  rectsIntersect,
  screenLengthToWorld,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomAbout,
  zoomToAbout,
  type Camera,
  type Vec2,
} from './camera.ts';

/**
 * Property tests, not example tests.
 *
 * Camera math fails at the boundaries — the zoom clamp, a degenerate viewport, a
 * subpixel-precision zoom level — and hand-picked examples are exactly the inputs that
 * avoid those. fast-check finds them, and prints a shrunk repro plus a seed when it does.
 */

/**
 * Coordinates in a range a real board actually uses. Deliberately not `fc.double()`
 * unbounded: at 1e300 float arithmetic loses associativity and every tolerance below
 * becomes meaningless, so an unbounded generator would only ever be testing IEEE754.
 */
const coord = () => fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });
const zoom = () => fc.double({ min: MIN_ZOOM, max: MAX_ZOOM, noNaN: true, noDefaultInfinity: true });
const point = (): fc.Arbitrary<Vec2> => fc.record({ x: coord(), y: coord() });
const camera = (): fc.Arbitrary<Camera> => fc.record({ x: coord(), y: coord(), zoom: zoom() });

/** Screen coordinates are bounded by any plausible viewport. */
const screenPoint = (): fc.Arbitrary<Vec2> =>
  fc.record({
    x: fc.double({ min: -8000, max: 8000, noNaN: true, noDefaultInfinity: true }),
    y: fc.double({ min: -8000, max: 8000, noNaN: true, noDefaultInfinity: true }),
  });

/** Relative closeness, so tolerance scales with magnitude instead of failing at 1e6. */
function closeTo(actual: number, expected: number, epsilon = 1e-9): boolean {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  return Math.abs(actual - expected) <= epsilon * scale;
}

group('screen <-> world', () => {
  it('round-trips', () => {
    fc.assert(
      fc.property(camera(), point(), (cam, worldPoint) => {
        const back = screenToWorld(cam, worldToScreen(cam, worldPoint));
        return closeTo(back.x, worldPoint.x) && closeTo(back.y, worldPoint.y);
      }),
    );
  });

  it('round-trips in the other direction too', () => {
    fc.assert(
      fc.property(camera(), screenPoint(), (cam, screen) => {
        const back = worldToScreen(cam, screenToWorld(cam, screen));
        return closeTo(back.x, screen.x) && closeTo(back.y, screen.y);
      }),
    );
  });

  it('puts the camera origin at the viewport top-left', () => {
    fc.assert(
      fc.property(camera(), (cam) => {
        const origin = worldToScreen(cam, { x: cam.x, y: cam.y });
        return closeTo(origin.x, 0) && closeTo(origin.y, 0);
      }),
    );
  });
});

group('zoomAbout keeps the anchor pinned', () => {
  it('the board point under the cursor stays under the cursor', () => {
    // THE invariant. Zooming about the viewport centre instead makes content slide out
    // from under the pointer, which users read as the app fighting them.
    fc.assert(
      fc.property(
        camera(),
        screenPoint(),
        fc.double({ min: 0.05, max: 20, noNaN: true, noDefaultInfinity: true }),
        (cam, anchor, factor) => {
          const before = screenToWorld(cam, anchor);
          const after = screenToWorld(zoomAbout(cam, anchor, factor), anchor);
          return closeTo(after.x, before.x, 1e-7) && closeTo(after.y, before.y, 1e-7);
        },
      ),
    );
  });

  it('stays pinned even when the zoom clamps', () => {
    // The case a naive implementation gets wrong: clamp the zoom but derive the offset from
    // the REQUESTED zoom, and the board drifts a little every time a user hits the limit.
    fc.assert(
      fc.property(
        camera(),
        screenPoint(),
        // Factors far outside the range, so the clamp always engages.
        fc.oneof(
          fc.double({ min: 1e4, max: 1e9, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 1e-9, max: 1e-4, noNaN: true, noDefaultInfinity: true }),
        ),
        (cam, anchor, factor) => {
          const zoomed = zoomAbout(cam, anchor, factor);
          expect(zoomed.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
          expect(zoomed.zoom).toBeLessThanOrEqual(MAX_ZOOM);
          const before = screenToWorld(cam, anchor);
          const after = screenToWorld(zoomed, anchor);
          return closeTo(after.x, before.x, 1e-7) && closeTo(after.y, before.y, 1e-7);
        },
      ),
    );
  });

  it('composes: many small zooms about one anchor do not drift', () => {
    // Wheel events arrive in bursts, so the composition of thirty small zooms is the real
    // workload — and accumulated drift is invisible in a single-step test.
    fc.assert(
      fc.property(camera(), screenPoint(), (cam, anchor) => {
        const before = screenToWorld(cam, anchor);
        let current = cam;
        for (let i = 0; i < 30; i++) current = zoomAbout(current, anchor, 1.1);
        for (let i = 0; i < 30; i++) current = zoomAbout(current, anchor, 1 / 1.1);
        const after = screenToWorld(current, anchor);
        return closeTo(after.x, before.x, 1e-6) && closeTo(after.y, before.y, 1e-6);
      }),
    );
  });

  it('zoomToAbout pins the anchor at an absolute zoom', () => {
    fc.assert(
      fc.property(camera(), screenPoint(), zoom(), (cam, anchor, target) => {
        const zoomed = zoomToAbout(cam, anchor, target);
        expect(closeTo(zoomed.zoom, target)).toBe(true);
        const before = screenToWorld(cam, anchor);
        const after = screenToWorld(zoomed, anchor);
        return closeTo(after.x, before.x, 1e-7) && closeTo(after.y, before.y, 1e-7);
      }),
    );
  });
});

group('panByScreen tracks the pointer exactly', () => {
  it('a world point moves by exactly the screen delta', () => {
    // If this is off by a zoom factor, dragging feels like the board is slipping — the
    // single most common canvas bug.
    fc.assert(
      fc.property(camera(), point(), screenPoint(), (cam, worldPoint, delta) => {
        const before = worldToScreen(cam, worldPoint);
        const after = worldToScreen(panByScreen(cam, delta), worldPoint);
        return (
          closeTo(after.x - before.x, delta.x, 1e-7) && closeTo(after.y - before.y, delta.y, 1e-7)
        );
      }),
    );
  });

  it('is reversible', () => {
    fc.assert(
      fc.property(camera(), screenPoint(), (cam, delta) => {
        const back = panByScreen(panByScreen(cam, delta), { x: -delta.x, y: -delta.y });
        return closeTo(back.x, cam.x, 1e-7) && closeTo(back.y, cam.y, 1e-7);
      }),
    );
  });
});

group('deviceMatrix', () => {
  const dpr = () => fc.double({ min: 1, max: 3, noNaN: true, noDefaultInfinity: true });

  it('agrees with worldToScreen scaled by dpr', () => {
    // The single source of truth: if the matrix and the pointer math disagree, a click
    // lands somewhere other than where it looks — the classic HiDPI failure.
    fc.assert(
      fc.property(camera(), point(), dpr(), (cam, worldPoint, ratio) => {
        const viaMatrix = applyMatrix(deviceMatrix(cam, ratio), worldPoint);
        const viaHelper = worldToScreen(cam, worldPoint);
        return (
          closeTo(viaMatrix.x, viaHelper.x * ratio, 1e-7) &&
          closeTo(viaMatrix.y, viaHelper.y * ratio, 1e-7)
        );
      }),
    );
  });

  it('is invertible, and the inverse round-trips', () => {
    fc.assert(
      fc.property(camera(), point(), dpr(), (cam, worldPoint, ratio) => {
        const matrix = deviceMatrix(cam, ratio);
        const inverse = invert(matrix);
        expect(inverse).toBeDefined();
        if (!inverse) return false;
        const back = applyMatrix(inverse, applyMatrix(matrix, worldPoint));
        return closeTo(back.x, worldPoint.x, 1e-7) && closeTo(back.y, worldPoint.y, 1e-7);
      }),
    );
  });

  it('refuses to invert a singular transform', () => {
    expect(invert({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })).toBeUndefined();
    expect(invert({ a: 1, b: 2, c: 2, d: 4, e: 0, f: 0 })).toBeUndefined(); // det = 0
  });
});

group('visibleWorldRect is the cull query', () => {
  const viewport = (): fc.Arbitrary<Vec2> =>
    fc.record({
      x: fc.double({ min: 1, max: 8000, noNaN: true, noDefaultInfinity: true }),
      y: fc.double({ min: 1, max: 8000, noNaN: true, noDefaultInfinity: true }),
    });

  it('contains exactly the board points at the viewport corners', () => {
    fc.assert(
      fc.property(camera(), viewport(), (cam, size) => {
        const rect = visibleWorldRect(cam, size);
        const corners: readonly Vec2[] = [
          screenToWorld(cam, { x: 0, y: 0 }),
          screenToWorld(cam, { x: size.x, y: 0 }),
          screenToWorld(cam, { x: 0, y: size.y }),
          screenToWorld(cam, { x: size.x, y: size.y }),
        ];
        return corners.every((corner) => rectContains(rect, corner));
      }),
    );
  });

  it('padding only ever grows the query', () => {
    // A cull that shrinks under padding pops shapes in at the edges — the symptom of
    // forgetting that a stroke half-width extends past a shape's geometry.
    fc.assert(
      fc.property(
        camera(),
        viewport(),
        fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
        (cam, size, padding) => {
          const tight = visibleWorldRect(cam, size);
          const padded = visibleWorldRect(cam, size, padding);
          return rectsIntersect(padded, tight) && padded.w >= tight.w && padded.h >= tight.h;
        },
      ),
    );
  });
});

group('fitToContent', () => {
  const rect = () =>
    fc.record({
      x: coord(),
      y: coord(),
      w: fc.double({ min: 1, max: 1e5, noNaN: true, noDefaultInfinity: true }),
      h: fc.double({ min: 1, max: 1e5, noNaN: true, noDefaultInfinity: true }),
    });

  it('brings the whole content into view', () => {
    fc.assert(
      fc.property(
        rect(),
        fc.record({
          x: fc.double({ min: 200, max: 4000, noNaN: true, noDefaultInfinity: true }),
          y: fc.double({ min: 200, max: 4000, noNaN: true, noDefaultInfinity: true }),
        }),
        (content, size) => {
          const cam = fitToContent(content, size, 32);
          const visible = visibleWorldRect(cam, size);
          // At the zoom floor a huge board genuinely cannot fit; the guarantee is then
          // "centred", which the next test covers.
          if (cam.zoom <= MIN_ZOOM) return true;
          return (
            content.x >= visible.x - 1e-6 &&
            content.y >= visible.y - 1e-6 &&
            content.x + content.w <= visible.x + visible.w + 1e-6 &&
            content.y + content.h <= visible.y + visible.h + 1e-6
          );
        },
      ),
    );
  });

  it('centres the content', () => {
    fc.assert(
      fc.property(rect(), (content) => {
        const size = { x: 1200, y: 800 };
        const cam = fitToContent(content, size);
        const visible = visibleWorldRect(cam, size);
        return (
          closeTo(visible.x + visible.w / 2, content.x + content.w / 2, 1e-6) &&
          closeTo(visible.y + visible.h / 2, content.y + content.h / 2, 1e-6)
        );
      }),
    );
  });

  it('degenerate input yields the default camera rather than an infinity', () => {
    expect(fitToContent({ x: 0, y: 0, w: 0, h: 0 }, { x: 100, y: 100 })).toEqual(DEFAULT_CAMERA);
    expect(fitToContent({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0 })).toEqual(DEFAULT_CAMERA);
  });
});

group('clampZoom', () => {
  it('always returns a usable zoom', () => {
    fc.assert(
      fc.property(fc.double(), (value) => {
        const result = clampZoom(value);
        return Number.isFinite(result) && result >= MIN_ZOOM && result <= MAX_ZOOM;
      }),
    );
  });

  it('collapses NaN to 1 rather than propagating it', () => {
    // A NaN zoom silently blanks the canvas: every transform becomes NaN and nothing draws,
    // with no error anywhere.
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

group('screenLengthToWorld', () => {
  it('keeps a fixed on-screen size at any zoom', () => {
    // Hit slop and stroke-width compensation both depend on this. Getting it backwards is
    // why hairlines become unclickable when zoomed out.
    fc.assert(
      fc.property(camera(), fc.double({ min: 1, max: 100, noNaN: true }), (cam, cssPixels) => {
        const worldLength = screenLengthToWorld(cam, cssPixels);
        const a = worldToScreen(cam, { x: 0, y: 0 });
        const b = worldToScreen(cam, { x: worldLength, y: 0 });
        return closeTo(b.x - a.x, cssPixels, 1e-7);
      }),
    );
  });
});

group('rect predicates', () => {
  it('intersection is symmetric', () => {
    const anyRect = () => fc.record({ x: coord(), y: coord(), w: coord(), h: coord() });
    fc.assert(
      fc.property(anyRect(), anyRect(), (a, b) => rectsIntersect(a, b) === rectsIntersect(b, a)),
    );
  });

  it('a rect intersects itself, and contains its own corners', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: coord(),
          y: coord(),
          w: fc.double({ min: 0, max: 1e5, noNaN: true }),
          h: fc.double({ min: 0, max: 1e5, noNaN: true }),
        }),
        (r) =>
          rectsIntersect(r, r) &&
          rectContains(r, { x: r.x, y: r.y }) &&
          rectContains(r, { x: r.x + r.w, y: r.y + r.h }),
      ),
    );
  });
});

group('cameraEquals', () => {
  it('is a cheap redraw gate', () => {
    fc.assert(fc.property(camera(), (cam) => cameraEquals(cam, { ...cam })));
    expect(cameraEquals(DEFAULT_CAMERA, { ...DEFAULT_CAMERA, zoom: 1.0000001 })).toBe(false);
  });
});
