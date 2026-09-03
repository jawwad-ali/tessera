import { describe as group, expect, it } from 'vitest';

import type { FracIdx, ShapeDraft, ShapeId, Style, Transform } from '../schema/shape.ts';
import { createMemoryStore } from './memory-store.ts';

/**
 * Drawing and dragging on the board.
 *
 * The describe names match the verifier commands in PHASES.md (`-t opCount`,
 * `-t "round trip"`) so those criteria select real tests rather than an empty set.
 */

/** Frames a slow drag across a board actually produces. */
const DRAG_FRAMES = 300;

const rectDraft = (id: string, idx: string): ShapeDraft => ({
  id: id as ShapeId,
  kind: 'rect',
  t: { x: 0, y: 0, w: 10, h: 10, rot: 0 } as unknown as Transform,
  idx: idx as FracIdx,
  style: {
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 1,
    opacity: 1,
  } as unknown as Style,
});

/** The same rectangle, moved. One frame of a drag. */
const at = (x: number, y: number): Transform =>
  ({ x, y, w: 10, h: 10, rot: 0 }) as unknown as Transform;

/**
 * One shape dragged for `frames` pointermove events, as a fresh board would see it.
 *
 * Shared by the 300-frame and 600-frame tests so that "doubling the frames changes
 * nothing" is the *same* code path run twice, not two hand-written near-duplicates that
 * could drift apart.
 */
const dragOneShape = (frames: number) => {
  const store = createMemoryStore({ author: 'u1', now: () => 0 });
  const id = 's1' as ShapeId;
  store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft(id, 'a0') }));

  const drag = store.gesture((tx) => {
    for (let frame = 1; frame <= frames; frame++) {
      tx.apply({ kind: 'transform', entries: [{ id, t: at(frame, 0) }] });
    }
    // Read back mid-gesture: a resize handle asks where the shape is *now*, and must not
    // be told where it was when the drag began.
    return tx.peek(id)?.t.x;
  });

  return { store, id, drag };
};

/** Three shapes marquee-selected and dragged together — one command per frame, three entries. */
const dragThreeShapes = (frames: number) => {
  const store = createMemoryStore({ author: 'u1', now: () => 0 });
  const first = 's1' as ShapeId;
  const second = 's2' as ShapeId;
  const third = 's3' as ShapeId;

  store.gesture((tx) => {
    tx.apply({ kind: 'create', draft: rectDraft(first, 'a0') });
    tx.apply({ kind: 'create', draft: rectDraft(second, 'a1') });
    tx.apply({ kind: 'create', draft: rectDraft(third, 'a2') });
  });

  const drag = store.gesture((tx) => {
    for (let frame = 1; frame <= frames; frame++) {
      tx.apply({
        kind: 'transform',
        entries: [
          { id: first, t: at(frame, 0) },
          { id: second, t: at(frame, 10) },
          { id: third, t: at(frame, 20) },
        ],
      });
    }
  });

  return { store, first, second, third, drag };
};

group('opCount', () => {
  it('drawing one rectangle puts it on the board', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    const id = 's1' as ShapeId;

    const result = store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft(id, 'a0') }));

    expect(result.committed).toBe(true);
    // One whole-map write, not one per field. A create is a single `put` at the root key,
    // which is why two clients creating the same id produce one shape rather than a chimera.
    expect(result.opCount).toBe(1);

    const drawn = store.get(id);
    expect(drawn?.t.w).toBe(10);
    // Attribution is stamped by the store, never taken from the draft — `ShapeDraft` omits
    // `author` and `v` precisely so a forged one is unrepresentable.
    expect(drawn?.author).toBe('u1');
    expect(drawn?.v).toBe(1);

    expect(store.drawOrder().map((shape) => shape.id)).toEqual([id]);
  });

  it('dragging one shape for a whole gesture costs one write', () => {
    const { store, id, drag } = dragOneShape(DRAG_FRAMES);

    expect(drag.committed).toBe(true);
    // 300 frames, one write. Not an optimisation: at 300 structs per drag a board becomes
    // slower to load with every gesture anyone ever made on it.
    expect(drag.opCount).toBe(1);
    // Staged reads see the staged value, not the pre-gesture one.
    expect(drag.value).toBe(DRAG_FRAMES);
    // And the write that survives is the last frame's, not the first.
    expect(store.get(id)?.t.x).toBe(DRAG_FRAMES);
  });

  it('dragging three shapes together costs three writes, one per shape', () => {
    const { store, first, second, third, drag } = dragThreeShapes(DRAG_FRAMES);

    // Per-shape, not per-selection and not per-frame: the collapse is keyed on the shape,
    // so a group drag scales with the selection and never with the gesture's duration.
    expect(drag.opCount).toBe(3);

    expect(store.get(first)?.t.y).toBe(0);
    expect(store.get(second)?.t.y).toBe(10);
    expect(store.get(third)?.t.y).toBe(20);
  });

  it('doubling the frame count changes neither total', () => {
    // The claim under test is frame-count *independence*. Asserting the literal 1 and 3
    // rather than equality with the 300-frame run, because equality alone would also hold
    // if both runs emitted one write per frame.
    expect(dragOneShape(DRAG_FRAMES * 2).drag.opCount).toBe(1);
    expect(dragThreeShapes(DRAG_FRAMES * 2).drag.opCount).toBe(3);
  });

  it('a group drag naming one missing shape moves none of them', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    const first = 's1' as ShapeId;
    const second = 's2' as ShapeId;
    store.gesture((tx) => {
      tx.apply({ kind: 'create', draft: rectDraft(first, 'a0') });
      tx.apply({ kind: 'create', draft: rectDraft(second, 'a1') });
    });

    // Two shapes and a ghost, marquee-selected together. A command reduces to one patch, so
    // it either applies whole or is refused whole. Half-applying it tears the selection
    // apart on screen with nothing raised to explain why.
    const drag = store.gesture((tx) =>
      tx.apply({
        kind: 'transform',
        entries: [
          { id: first, t: at(50, 0) },
          { id: 'ghost' as ShapeId, t: at(50, 10) },
          { id: second, t: at(50, 20) },
        ],
      }),
    );

    expect(drag.value).toEqual({ ok: false, reason: 'unknown-shape' });
    expect(drag.opCount).toBe(0);
    expect(store.get(first)?.t.x).toBe(0);
    expect(store.get(second)?.t.x).toBe(0);
  });

  it('dragging a shape that is not on the board is refused and costs nothing', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });

    // A stale selection: the shape was deleted, or an undo removed it, and the pointer is
    // still down on it. The frame has to be refused rather than staged, or the commit
    // writes a shape with geometry and nothing else.
    const result = store.gesture((tx) =>
      tx.apply({ kind: 'transform', entries: [{ id: 'ghost' as ShapeId, t: at(1, 1) }] }),
    );

    expect(result.value).toEqual({ ok: false, reason: 'unknown-shape' });
    expect(result.committed).toBe(false);
    expect(result.opCount).toBe(0);
    expect(store.has('ghost' as ShapeId)).toBe(false);
  });
});
