import { describe as group, expect, it } from 'vitest';

import type { Camera, DrawItem, FracIdx, Shape, ShapeId, Style, Transform } from '@tessera/core';
import { DEFAULT_CAMERA, createMemoryStore, visibleShapes } from '@tessera/core';
import type { Painter2D } from './static-layer.ts';
import { paintStatic } from './static-layer.ts';

/**
 * Painting the committed shapes.
 *
 * The describe name matches the verifier in PHASES.md (`-t painting`).
 *
 * Driven against a recording fake rather than a real canvas, because the questions worth
 * asking here are about the *sequence of calls* — how many transforms, in what order, with
 * what widths — and a pixel readback cannot distinguish "one transform for the plan" from
 * "one transform per shape". `3.C1` asks the pixel question in a real browser; this asks the
 * ones a browser answers with a screenshot.
 */

interface Call {
  readonly op: string;
  readonly args: readonly number[];
}

/** Records what a painter was asked to do, in order. */
const recorder = (): Painter2D & { readonly calls: readonly Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    setTransform: (a, b, c, d, e, f) => calls.push({ op: 'setTransform', args: [a, b, c, d, e, f] }),
    clearRect: (x, y, w, h) => calls.push({ op: 'clearRect', args: [x, y, w, h] }),
    beginPath: () => calls.push({ op: 'beginPath', args: [] }),
    rect: (x, y, w, h) => calls.push({ op: 'rect', args: [x, y, w, h] }),
    fill: () => calls.push({ op: 'fill', args: [] }),
    stroke: () => calls.push({ op: 'stroke', args: [] }),
  };
};

const shape = (id: string, idx: string, x: number, y: number, w = 10, h = 10): Shape => ({
  id: id as ShapeId,
  v: 1,
  kind: 'rect',
  t: { x, y, w, h, rot: 0 } as unknown as Transform,
  idx: idx as FracIdx,
  author: 'u1',
  style: {
    fill: '#ff0000',
    stroke: '#0000ff',
    strokeWidth: 2,
    opacity: 1,
  } as unknown as Style,
});

const planFor = (shapes: readonly Shape[]): readonly DrawItem[] =>
  shapes.map((s) => ({ shape: s, device: { x: 0, y: 0, w: 0, h: 0 } }));

const viewport = { css: { x: 800, y: 600 }, dpr: 2 };

group('painting', () => {
  it('clears the whole backing store before it draws anything', () => {
    const ctx = recorder();

    paintStatic(ctx, planFor([shape('a', 'a0', 0, 0)]), DEFAULT_CAMERA, viewport);

    // Device pixels, not CSS: clearing 800x600 on a dpr-2 canvas leaves three quarters of the
    // previous frame on screen, which shows up as smearing while panning.
    const clear = ctx.calls.find((call) => call.op === 'clearRect');
    expect(clear?.args).toEqual([0, 0, 1600, 1200]);
    expect(ctx.calls.indexOf(clear!)).toBeLessThan(
      ctx.calls.findIndex((call) => call.op === 'fill'),
    );
  });

  it('clears even when there is nothing left to draw', () => {
    const ctx = recorder();

    paintStatic(ctx, [], DEFAULT_CAMERA, viewport);

    // Deleting the last shape has to leave an empty board, not the last frame that had one.
    expect(ctx.calls.map((call) => call.op)).toEqual(['setTransform', 'clearRect', 'setTransform']);
  });

  it('sets the transform once for the whole plan, not once per shape', () => {
    const ctx = recorder();
    const plan = planFor([shape('a', 'a0', 0, 0), shape('b', 'a1', 20, 0), shape('c', 'a2', 40, 0)]);

    paintStatic(ctx, plan, DEFAULT_CAMERA, viewport);

    // Two: the identity used to clear the backing store, and the camera used to draw. A
    // transform per shape is the classic way to make a 5,000-shape board 5,000 state changes.
    expect(ctx.calls.filter((call) => call.op === 'setTransform')).toHaveLength(2);
  });

  it('draws through the camera transform, so a pan moves pixels by the drag distance', () => {
    const ctx = recorder();
    const camera: Camera = { x: 100, y: 50, zoom: 2 };

    paintStatic(ctx, planFor([shape('a', 'a0', 0, 0)]), camera, viewport);

    // scale = zoom * dpr = 4; e = -100 * 4, f = -50 * 4. This is the equality 3.C1 checks
    // through pixels: drag 200 CSS px and the shape's box moves 200 CSS px, no more.
    const draw = ctx.calls.filter((call) => call.op === 'setTransform')[1];
    expect(draw?.args).toEqual([4, 0, 0, 4, -400, -200]);
  });

  it('paints every shape in the order the plan gave', () => {
    const ctx = recorder();
    const plan = planFor([shape('back', 'a0', 0, 0), shape('front', 'a1', 5, 5)]);

    paintStatic(ctx, plan, DEFAULT_CAMERA, viewport);

    // `rect` calls carry the world geometry, so their order is the z-order that reached the
    // canvas. Painting the plan out of order is invisible in a screenshot of non-overlapping
    // shapes and obvious in one where they overlap.
    const rects = ctx.calls.filter((call) => call.op === 'rect').map((call) => call.args[0]);
    expect(rects).toEqual([0, 5]);
  });

  it('strokes in world units, so a stroke scales with the shape', () => {
    const ctx = recorder();

    paintStatic(ctx, planFor([shape('a', 'a0', 0, 0)]), { x: 0, y: 0, zoom: 8 }, viewport);

    // `lineWidth` is applied under the transform, so the shape's own 2 units is what goes in.
    // Dividing by the scale would give a hairline that stays 2 device px at every zoom, which
    // is right for a selection outline and wrong for a pen stroke someone drew.
    expect(ctx.lineWidth).toBe(2);
  });

  it('draws what the projection selected, end to end', () => {
    // The two halves joined: a real store, a real cull, a real paint. Guards against the two
    // agreeing separately and disagreeing together.
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    store.gesture((tx) => {
      tx.apply({
        kind: 'create',
        draft: { id: 'near' as ShapeId, kind: 'rect', t: shape('x', 'a0', 10, 10).t, idx: 'a0' as FracIdx, style: shape('x', 'a0', 0, 0).style },
      });
      tx.apply({
        kind: 'create',
        draft: { id: 'far' as ShapeId, kind: 'rect', t: shape('x', 'a1', 9_000, 9_000).t, idx: 'a1' as FracIdx, style: shape('x', 'a1', 0, 0).style },
      });
    });

    const ctx = recorder();
    paintStatic(ctx, visibleShapes(store, DEFAULT_CAMERA, viewport), DEFAULT_CAMERA, viewport);

    expect(ctx.calls.filter((call) => call.op === 'rect')).toHaveLength(1);
    expect(ctx.calls.find((call) => call.op === 'rect')?.args).toEqual([10, 10, 10, 10]);
  });
});
