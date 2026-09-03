import { describe as group, expect, it } from 'vitest';

import type { FracIdx, ShapeDraft, ShapeId, Style, Transform } from '../schema/shape.ts';
import { DEFAULT_CAMERA } from '../camera/camera.ts';
import { createMemoryStore } from './memory-store.ts';
import { visibleShapes } from './visible.ts';

/**
 * What the renderer is asked to paint, and where.
 *
 * The describe names match the verifiers in PHASES.md (`-t culling`, `-t projection`).
 *
 * This is the pure half of `3.C1`. That criterion proves a pixel lands inside a known shape's
 * projected box by reading the canvas back in a real browser; this decides *which* box, in
 * device pixels, with no browser involved. Getting it wrong here means the pixel test fails
 * with a screenshot instead of a number, so it is tested first and separately.
 */

const rect = (id: string, idx: string, x: number, y: number, w = 10, h = 10): ShapeDraft => ({
  id: id as ShapeId,
  kind: 'rect',
  t: { x, y, w, h, rot: 0 } as unknown as Transform,
  idx: idx as FracIdx,
  style: {
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 1,
    opacity: 1,
  } as unknown as Style,
});

/** A board with shapes spread along a diagonal, 1,000 board units apart. */
const board = (count: number) => {
  const store = createMemoryStore({ author: 'u1', now: () => 0 });
  store.gesture((tx) => {
    for (let n = 0; n < count; n++) {
      tx.apply({ kind: 'create', draft: rect(`s${n}`, `a${n}`, n * 1_000, n * 1_000) });
    }
  });
  return store;
};

group('culling', () => {
  it('paints only what is on screen', () => {
    // Zoomed in on the origin: one shape of ten is within the viewport, and the other nine
    // are thousands of board units away. Painting all ten is what makes a big board slow for
    // no visible benefit.
    const store = board(10);

    const items = visibleShapes(store, DEFAULT_CAMERA, { css: { x: 800, y: 600 }, dpr: 1 });

    expect(items.map((item) => item.shape.id)).toEqual(['s0']);
  });

  it('paints everything when the camera can see everything', () => {
    // Zoom-to-fit is the first thing every user does, and it is the case where culling saves
    // nothing at all — which is why LOD exists and why this phase's baseline is measured here.
    const store = board(10);

    const items = visibleShapes(
      store,
      { x: -100, y: -100, zoom: 0.05 },
      { css: { x: 800, y: 600 }, dpr: 1 },
    );

    expect(items).toHaveLength(10);
  });

  it('keeps a shape whose stroke reaches into the viewport but whose body does not', () => {
    // A shape just off the left edge, close enough that half its stroke width still lands on
    // screen. Culling it makes shapes pop in at the edges during a pan, which reads as a
    // rendering bug rather than as an optimisation.
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    store.gesture((tx) => {
      tx.apply({ kind: 'create', draft: rect('edge', 'a0', -10.4, 100, 10, 10) });
    });

    const items = visibleShapes(store, DEFAULT_CAMERA, { css: { x: 800, y: 600 }, dpr: 1 });

    expect(items.map((item) => item.shape.id)).toEqual(['edge']);
  });

  it('paints in draw order, not in query order', () => {
    // The spatial index returns candidates in cell order, which has nothing to do with z.
    // Painting in that order puts shapes behind shapes they should cover.
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    store.gesture((tx) => {
      tx.apply({ kind: 'create', draft: rect('top', 'a2', 0, 0, 50, 50) });
      tx.apply({ kind: 'create', draft: rect('bottom', 'a0', 5, 5, 50, 50) });
      tx.apply({ kind: 'create', draft: rect('middle', 'a1', 10, 10, 50, 50) });
    });

    const items = visibleShapes(store, DEFAULT_CAMERA, { css: { x: 800, y: 600 }, dpr: 1 });

    expect(items.map((item) => item.shape.id)).toEqual(['bottom', 'middle', 'top']);
  });

  it('drops a candidate the index offered but the viewport does not contain', () => {
    // The index files by 256-unit cells, so a shape at x=900 shares a cell with the viewport's
    // right edge and comes back as a candidate even though it is entirely outside. Trusting
    // the superset costs a transform and a fill per shape that produces no pixels, which shows
    // up as a frame-time floor that does not fall when you zoom in.
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    store.gesture((tx) => {
      tx.apply({ kind: 'create', draft: rect('inside', 'a0', 700, 100) });
      tx.apply({ kind: 'create', draft: rect('outside', 'a1', 900, 100) });
    });

    // Same cell, opposite answers.
    expect(store.query({ x: -32, y: -32, w: 864, h: 664 })).toContain('outside' as ShapeId);

    const items = visibleShapes(store, DEFAULT_CAMERA, { css: { x: 800, y: 600 }, dpr: 1 });

    expect(items.map((item) => item.shape.id)).toEqual(['inside']);
  });

  it('still paints a shape after it has been dragged somewhere else', () => {
    // The bug this catches makes a dragged shape VANISH: the index keeps the position the
    // shape was created at, so the cull query at its new home finds nothing there. Found by
    // mutation testing rather than by review, because every other test queries a shape at the
    // position it was created at.
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    const id = 'moved' as ShapeId;
    store.gesture((tx) => tx.apply({ kind: 'create', draft: rect(id, 'a0', 0, 0) }));

    store.gesture((tx) =>
      tx.apply({
        kind: 'transform',
        entries: [{ id, t: { x: 5_000, y: 5_000, w: 10, h: 10, rot: 0 } as unknown as Transform }],
      }),
    );

    const atNewHome = visibleShapes(
      store,
      { x: 4_900, y: 4_900, zoom: 1 },
      { css: { x: 800, y: 600 }, dpr: 1 },
    );
    expect(atNewHome.map((item) => item.shape.id)).toEqual([id]);

    // And it is no longer at the old one.
    const atOldHome = visibleShapes(store, DEFAULT_CAMERA, { css: { x: 800, y: 600 }, dpr: 1 });
    expect(atOldHome).toEqual([]);
  });

  it('stops offering a shape once it is deleted', () => {
    // `query` promises candidates that intersect the rect, and a deleted shape is a candidate
    // for nothing. Leaving it in makes the index grow for the life of the board — invisible in
    // the output, because the caller drops an id whose shape has gone, and visible only as a
    // board that gets slower the longer anyone edits it.
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    const id = 'gone' as ShapeId;
    store.gesture((tx) => tx.apply({ kind: 'create', draft: rect(id, 'a0', 0, 0) }));

    store.gesture((tx) => tx.apply({ kind: 'delete', ids: [id] }));

    expect(store.query({ x: -1_000, y: -1_000, w: 2_000, h: 2_000 })).toEqual([]);
  });
});

group('projection', () => {
  it('places a shape where the camera says it is', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    store.gesture((tx) => {
      tx.apply({ kind: 'create', draft: rect('one', 'a0', 100, 50, 20, 40) });
    });

    // Camera at (40, 10), zoom 2, dpr 2 — so world 100 lands at (100 - 40) * 2 * 2 = 240
    // device pixels, and a 20-unit width becomes 20 * 2 * 2 = 80.
    const items = visibleShapes(
      store,
      { x: 40, y: 10, zoom: 2 },
      { css: { x: 800, y: 600 }, dpr: 2 },
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.device).toEqual({ x: 240, y: 160, w: 80, h: 160 });
  });

  it('projects a rotated shape to the box that actually contains it', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    store.gesture((tx) => {
      tx.apply({
        kind: 'create',
        draft: {
          ...rect('turned', 'a0', 0, 0, 40, 10),
          t: { x: 0, y: 0, w: 40, h: 10, rot: Math.PI / 2 } as unknown as Transform,
        },
      });
    });

    const items = visibleShapes(store, DEFAULT_CAMERA, { css: { x: 800, y: 600 }, dpr: 1 });

    // A quarter-turned wide rectangle is a TALL box. Its centre does not move, so a 40x10 at
    // the origin becomes 10 wide and 40 tall, centred on (20, 5).
    const device = items[0]?.device;
    expect(device?.w).toBeCloseTo(10, 6);
    expect(device?.h).toBeCloseTo(40, 6);
    expect(device?.x).toBeCloseTo(15, 6);
    expect(device?.y).toBeCloseTo(-15, 6);
  });

  it('rounds nothing, because the painter needs the exact edge', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    store.gesture((tx) => {
      tx.apply({ kind: 'create', draft: rect('frac', 'a0', 0.5, 0.5, 1, 1) });
    });

    const items = visibleShapes(store, DEFAULT_CAMERA, { css: { x: 800, y: 600 }, dpr: 1.5 });

    // Half-pixel snapping is the painter's decision, made per stroke width, and it cannot be
    // made twice. Rounding here would move the geometry the pixel test measures against.
    expect(items[0]?.device.x).toBeCloseTo(0.75, 6);
  });
});
