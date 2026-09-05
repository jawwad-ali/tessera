import { describe as group, expect, it } from 'vitest';

import type { FracIdx, Shape, ShapeId, Style, Transform } from '@tessera/core';
import { DEFAULT_CAMERA } from '@tessera/core';
import { paintOverlay } from './overlay-layer.ts';
import type { Painter2D } from './static-layer.ts';

/**
 * The overlay, against a recorder.
 *
 * The describe name matches the verifier in PHASES.md (`-t overlay`).
 */

interface Call {
  readonly op: string;
  readonly args: readonly number[];
}

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

const viewport = { css: { x: 800, y: 600 }, dpr: 2 };
const rects = (ctx: { readonly calls: readonly Call[] }) => ctx.calls.filter((c) => c.op === 'rect');

const ghost: Shape = {
  id: 'g' as ShapeId,
  v: 1,
  kind: 'rect',
  t: { x: 50, y: 60, w: 10, h: 10, rot: 0 } as unknown as Transform,
  idx: 'a0' as FracIdx,
  author: 'u1',
  style: { fill: '#2563eb', stroke: '#0f172a', strokeWidth: 1, opacity: 1 } as unknown as Style,
};

group('overlay', () => {
  it('clears and paints nothing when nothing is happening', () => {
    const ctx = recorder();

    paintOverlay(ctx, { selection: undefined, marquee: undefined, ghosts: [] }, DEFAULT_CAMERA, viewport);

    expect(ctx.calls.map((c) => c.op)).toEqual(['setTransform', 'clearRect']);
  });

  it('draws eight handles of a fixed screen size, whatever the zoom', () => {
    const ctx = recorder();
    const selection = { x: 100, y: 100, w: 200, h: 100 };

    paintOverlay(ctx, { selection, marquee: undefined, ghosts: [] }, { x: 0, y: 0, zoom: 4 }, viewport);

    // One selection box plus eight handles. Every handle is 8 CSS px = 16 device px at dpr 2,
    // and would be 8 board units = 64 device px if it were drawn under the camera by mistake.
    const boxes = rects(ctx);
    expect(boxes).toHaveLength(9);
    const handles = boxes.slice(1);
    expect(handles.every((h) => h.args[2] === 16 && h.args[3] === 16)).toBe(true);
  });

  it('projects the selection box through the camera', () => {
    const ctx = recorder();

    paintOverlay(
      ctx,
      { selection: { x: 100, y: 100, w: 200, h: 100 }, marquee: undefined, ghosts: [] },
      { x: 50, y: 50, zoom: 2 },
      viewport,
    );

    // (100 - 50) * 2 * 2 = 200 device px; 200 wide * 4 = 800.
    expect(rects(ctx)[0]?.args).toEqual([200, 200, 800, 400]);
  });

  it('paints a drag ghost under the camera transform, at its in-flight position', () => {
    const ctx = recorder();

    paintOverlay(ctx, { selection: undefined, marquee: undefined, ghosts: [ghost] }, { x: 0, y: 0, zoom: 2 }, viewport);

    // The ghost's rect is issued in BOARD units under a camera transform — like a committed
    // shape — so its `rect` carries the shape's own geometry, not device pixels.
    expect(rects(ctx)[0]?.args).toEqual([50, 60, 10, 10]);
    const transforms = ctx.calls.filter((c) => c.op === 'setTransform');
    expect(transforms[1]?.args).toEqual([4, 0, 0, 4, -0, -0]);
  });

  it('paints the marquee in screen space with a translucent fill', () => {
    const ctx = recorder();

    paintOverlay(ctx, { selection: undefined, marquee: { x: 10, y: 10, w: 30, h: 20 }, ghosts: [] }, DEFAULT_CAMERA, viewport);

    expect(rects(ctx)[0]?.args).toEqual([20, 20, 60, 40]);
    expect(ctx.calls.some((c) => c.op === 'fill')).toBe(true);
    expect(ctx.fillStyle).toContain('rgba');
  });
});
