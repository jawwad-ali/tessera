import { describe as group, expect, it } from 'vitest';

import type { FracIdx, ShapeDraft, ShapeId, Style, Transform } from '@tessera/core';
import { createMemoryStore } from '@tessera/core';
import { hitTest } from './hit.ts';

/**
 * Which shape is under the pointer.
 *
 * The describe name matches the verifier in PHASES.md (`-t "hit test"`).
 *
 * Three tiers by design: the spatial index narrows to candidates, an oriented-box test rejects
 * the ones whose *rotated body* the point misses, and `isPointInStroke` on a scratch context
 * decides freehand ink. Only the first two are here — rectangles are exact at tier two, and the
 * pen tool is the phase's release valve.
 */

const rect = (id: string, x: number, y: number, w: number, h: number, rot = 0, idx = 'a0'): ShapeDraft => ({
  id: id as ShapeId,
  kind: 'rect',
  t: { x, y, w, h, rot } as unknown as Transform,
  idx: idx as FracIdx,
  style: { fill: '#2563eb', stroke: '#0f172a', strokeWidth: 1, opacity: 1 } as unknown as Style,
});

const board = (...drafts: readonly ShapeDraft[]) => {
  const store = createMemoryStore({ author: 'u1', now: () => 0 });
  store.gesture((tx) => {
    for (const draft of drafts) tx.apply({ kind: 'create', draft });
  });
  return store;
};

group('hit test', () => {
  it('finds the shape under the pointer', () => {
    const store = board(rect('a', 100, 100, 40, 30));

    expect(hitTest(store, { x: 120, y: 115 }, 0)).toBe('a');
  });

  it('finds nothing on empty board', () => {
    const store = board(rect('a', 100, 100, 40, 30));

    expect(hitTest(store, { x: 500, y: 500 }, 0)).toBeUndefined();
  });

  it('forgives a near miss within the slop, and not beyond it', () => {
    // Slop is in board units here; the adapter converts 10 CSS px by the zoom. A fixed
    // board-unit slop is un-clickable when zoomed out and grabs the neighbour when zoomed in.
    const store = board(rect('a', 100, 100, 40, 30));

    expect(hitTest(store, { x: 97, y: 115 }, 5)).toBe('a');
    expect(hitTest(store, { x: 93, y: 115 }, 5)).toBeUndefined();
  });

  it('picks the topmost shape where two overlap, by draw order and not by creation order', () => {
    // `top` is created first but sorts above `bottom`. The one a user sees is the one they
    // should grab; picking by creation order grabs the shape hidden underneath.
    const store = board(rect('top', 100, 100, 40, 30, 0, 'a5'), rect('bottom', 110, 110, 40, 30, 0, 'a1'));

    expect(hitTest(store, { x: 125, y: 120 }, 0)).toBe('top');
  });

  it('tests the rotated body, not its axis-aligned box', () => {
    // A 40x10 bar turned 45 degrees. Its bounding box is a ~35x35 square; most of that square
    // is empty. The index offers the shape as a candidate for any point in the square — that
    // is tier one — and tier two has to say no for the empty corners.
    const store = board(rect('bar', 0, 0, 40, 10, Math.PI / 4));

    // Centre is (20, 5). Straight above the centre, inside the box, outside the bar.
    expect(hitTest(store, { x: 20, y: 17 }, 0)).toBeUndefined();
    // Along the diagonal the bar actually lies on.
    expect(hitTest(store, { x: 28, y: 13 }, 0)).toBe('bar');
  });

  it('a point exactly on the edge counts as inside', () => {
    // Clicking the outline of a shape is the most natural way to grab a hollow one.
    const store = board(rect('a', 100, 100, 40, 30));

    expect(hitTest(store, { x: 100, y: 100 }, 0)).toBe('a');
    expect(hitTest(store, { x: 140, y: 130 }, 0)).toBe('a');
  });
});
