import { describe as group, expect, it } from 'vitest';

import type { FracIdx, ShapeDraft, ShapeId, Style, Transform } from '../schema/shape.ts';
import type { DirtyView } from './store.ts';
import { DIRTY_FLAGS } from './dirty.ts';
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

/** A style differing only in fill, for recolour tests. */
const styleWith = (fill: string): Style =>
  ({ fill, stroke: '#000000', strokeWidth: 1, opacity: 1 }) as unknown as Style;

/** The same rectangle, moved and optionally turned. One frame of a drag. */
const at = (x: number, y: number, rot = 0): Transform =>
  ({ x, y, w: 10, h: 10, rot }) as unknown as Transform;

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

group('round trip', () => {
  it('a drag that ends where it began writes nothing', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    const id = 's1' as ShapeId;
    store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft(id, 'a0') }));

    const before = store.get(id);
    expect(before).toBeDefined();

    const drag = store.gesture((tx) => {
      for (let frame = 1; frame < DRAG_FRAMES; frame++) {
        tx.apply({ kind: 'transform', entries: [{ id, t: at(frame, frame) }] });
      }
      // Dropped back on the spot it was picked up from — the user changed their mind.
      tx.apply({ kind: 'transform', entries: [{ id, t: at(0, 0) }] });
    });

    // Suppressing this is not an optimisation. Without it every cancelled drag leaves a
    // struct on the wire and a Ctrl+Z that visibly does nothing.
    expect(drag.committed).toBe(false);
    expect(drag.opCount).toBe(0);
    // Not merely equal — the committed shape was never replaced.
    expect(store.get(id)).toBe(before);
  });

  it('a rotation that returns to -0 is not a change', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    const id = 's1' as ShapeId;
    store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft(id, 'a0') }));

    const turn = store.gesture((tx) => {
      tx.apply({ kind: 'transform', entries: [{ id, t: at(0, 0, 1.5) }] });
      // A full turn back. Negating an angle is how this arrives in practice, and it lands
      // on -0 rather than 0 — the same shape on screen, and `Object.is` disagrees.
      tx.apply({ kind: 'transform', entries: [{ id, t: at(0, 0, -0) }] });
    });

    expect(turn.committed).toBe(false);
    expect(turn.opCount).toBe(0);
  });

  it('only the shapes that actually moved are written', () => {
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
      for (let frame = 1; frame <= DRAG_FRAMES; frame++) {
        tx.apply({
          kind: 'transform',
          entries: [
            { id: first, t: at(frame, 0) },
            { id: second, t: at(frame, 0) },
            { id: third, t: at(frame, 0) },
          ],
        });
      }
      // The middle one is nudged back to where it started; the others are dropped where
      // they are. Suppression is per shape, so this gesture costs two writes, not three
      // and not zero.
      tx.apply({ kind: 'transform', entries: [{ id: second, t: at(0, 0) }] });
    });

    expect(drag.committed).toBe(true);
    expect(drag.opCount).toBe(2);
    expect(store.get(first)?.t.x).toBe(DRAG_FRAMES);
    expect(store.get(second)?.t.x).toBe(0);
    expect(store.get(third)?.t.x).toBe(DRAG_FRAMES);
  });
});

group('subscribe', () => {
  const listen = () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    const seen: { mask: number; ids: readonly string[]; origin: string; stalled: boolean }[] = [];
    const stop = store.subscribe((view) => {
      // A listener marks ids dirty and returns. There is nothing here to draw *with* — the
      // view carries no shapes — so this is the whole of what an observer can do.
      seen.push({
        mask: view.mask,
        ids: [...view.ids],
        origin: view.origin.kind,
        stalled: view.stalled,
      });
    });
    return { store, seen, stop };
  };

  it('notifies once for a whole drag, however many frames it took', () => {
    const { store, seen } = listen();
    const id = 's1' as ShapeId;
    store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft(id, 'a0') }));
    seen.length = 0;

    store.gesture((tx) => {
      for (let frame = 1; frame <= DRAG_FRAMES; frame++) {
        tx.apply({ kind: 'transform', entries: [{ id, t: at(frame, 0) }] });
      }
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.ids).toEqual([id]);
    // Geometry only. A drag must not invalidate the draw order, which is the one O(n log n)
    // rebuild in the renderer.
    expect(seen[0]?.mask).toBe(DIRTY_FLAGS.geometry);
    expect(seen[0]?.origin).toBe('local-gesture');
    // Single-player: no peers, so no unintegrated structs, ever.
    expect(seen[0]?.stalled).toBe(false);
  });

  it('notifies once for a group drag, not once per shape', () => {
    const { store, seen } = listen();
    const first = 's1' as ShapeId;
    const second = 's2' as ShapeId;
    const third = 's3' as ShapeId;
    store.gesture((tx) => {
      tx.apply({ kind: 'create', draft: rectDraft(first, 'a0') });
      tx.apply({ kind: 'create', draft: rectDraft(second, 'a1') });
      tx.apply({ kind: 'create', draft: rectDraft(third, 'a2') });
    });
    seen.length = 0;

    store.gesture((tx) => {
      for (let frame = 1; frame <= DRAG_FRAMES; frame++) {
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

    // Three writes, ONE notification. A gesture is one repaint however many shapes it
    // touched, and the ids arrive together so the renderer marks them in one pass and draws
    // them in one frame. Notifying per write would tear a group drag across three frames.
    expect(seen).toHaveLength(1);
    expect([...(seen[0]?.ids ?? [])].sort()).toEqual([first, second, third]);
    expect(seen[0]?.mask).toBe(DIRTY_FLAGS.geometry);
  });

  it('says nothing at all when a drag is cancelled', () => {
    const { store, seen } = listen();
    const id = 's1' as ShapeId;
    store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft(id, 'a0') }));
    seen.length = 0;

    store.gesture((tx) => {
      tx.apply({ kind: 'transform', entries: [{ id, t: at(50, 50) }] });
      tx.apply({ kind: 'transform', entries: [{ id, t: at(0, 0) }] });
    });

    // The other half of 1.C3: a cancelled drag leaves no struct *and* no repaint.
    expect(seen).toEqual([]);
  });

  it('reports a new shape as changing both what exists and where it sorts', () => {
    const { store, seen } = listen();

    store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft('s1', 'a0') }));

    expect(seen).toHaveLength(1);
    // `existence` implies `order`: a create has to re-sort the scene, and the renderer needs
    // to be told so rather than inferring it.
    expect(seen[0]?.mask).toBe(DIRTY_FLAGS.existence | DIRTY_FLAGS.order);
  });

  it('gives each gesture its own id, so a change can be traced to one', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    const ids: (string | undefined)[] = [];
    store.subscribe((view) => ids.push(view.origin.gestureId));

    store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft('s1', 'a0') }));
    store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft('s2', 'a1') }));

    expect(ids[0]).toBeDefined();
    expect(ids[1]).toBeDefined();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('stops notifying once unsubscribed', () => {
    const { store, seen, stop } = listen();
    stop();

    store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft('s1', 'a0') }));

    expect(seen).toEqual([]);
  });
});

group('revoked', () => {
  it('refuses to be read after its notification has returned', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    let escaped: DirtyView | undefined;
    store.subscribe((view) => {
      escaped = view;
    });

    store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft('s1', 'a0') }));

    expect(escaped).toBeDefined();
    // Captured into a closure, or into component state, and read a frame later — by which
    // time the next transaction has already invalidated it. Silently reading a stale
    // snapshot is how a renderer draws a shape that has moved; this makes it loud.
    expect(() => escaped?.mask).toThrow(/revoked/i);
    expect(() => escaped?.ids).toThrow(/revoked/i);
    expect(() => escaped?.origin).toThrow(/revoked/i);
    expect(() => escaped?.stalled).toThrow(/revoked/i);
  });

  it('refuses a listener that writes back into the store', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    store.subscribe(() => {
      // A listener that "fixes up" the scene in response to a change. In the Yjs store this
      // nests one transaction inside another and puts an undo step inside an undo step.
      store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft('s2', 'a1') }));
    });

    expect(() =>
      store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft('s1', 'a0') })),
    ).toThrow(/re-entrant/i);
  });
});

group('tools', () => {
  const withThree = () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    const first = 's1' as ShapeId;
    const second = 's2' as ShapeId;
    const third = 's3' as ShapeId;
    store.gesture((tx) => {
      tx.apply({ kind: 'create', draft: rectDraft(first, 'a0') });
      tx.apply({ kind: 'create', draft: rectDraft(second, 'a1') });
      tx.apply({ kind: 'create', draft: rectDraft(third, 'a2') });
    });
    return { store, first, second, third };
  };

  const orderOf = (store: ReturnType<typeof createMemoryStore>) =>
    store.drawOrder().map((shape) => shape.id);

  it.skip('bringing a shape to the front puts it last in draw order', () => {
    const { store, first, second, third } = withThree();

    // The caller resolves "bring to front" to a concrete index before the command exists —
    // a reducer that read its neighbours would be order-dependent.
    const result = store.gesture((tx) =>
      tx.apply({ kind: 'reorder', entries: [{ id: first, idx: 'a3' as FracIdx }] }),
    );

    expect(result.opCount).toBe(1);
    expect(orderOf(store)).toEqual([second, third, first]);
  });

  it('recolouring a shape changes its style and leaves its geometry alone', () => {
    const { store, first } = withThree();
    const before = store.get(first)?.t;

    const result = store.gesture((tx) =>
      tx.apply({ kind: 'restyle', entries: [{ id: first, style: styleWith('#ff0000') }] }),
    );

    expect(result.opCount).toBe(1);
    expect(store.get(first)?.style.fill).toBe('#ff0000');
    expect(store.get(first)?.t).toEqual(before);
  });

  it('recolouring to the same colour writes nothing', () => {
    const { store, first } = withThree();
    const current = store.get(first)?.style;
    expect(current).toBeDefined();

    const result = store.gesture((tx) =>
      tx.apply({ kind: 'restyle', entries: [{ id: first, style: current! }] }),
    );

    // Same suppression rule as a cancelled drag, on the other hot key.
    expect(result.committed).toBe(false);
    expect(result.opCount).toBe(0);
  });

  it('deleting a shape takes it off the board', () => {
    const { store, first, second, third } = withThree();

    const result = store.gesture((tx) => tx.apply({ kind: 'delete', ids: [second] }));

    expect(result.opCount).toBe(1);
    expect(store.has(second)).toBe(false);
    expect(store.get(second)).toBeUndefined();
    expect(orderOf(store)).toEqual([first, third]);
  });

  it('drawing a shape and deleting it in one gesture writes nothing', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    const id = 's9' as ShapeId;

    const result = store.gesture((tx) => {
      tx.apply({ kind: 'create', draft: rectDraft(id, 'a0') });
      tx.apply({ kind: 'delete', ids: [id] });
    });

    // Net nothing, so nothing is written and nothing repaints — the same rule as a drag that
    // ends where it began, applied to existence rather than to geometry.
    expect(result.committed).toBe(false);
    expect(result.opCount).toBe(0);
    expect(store.has(id)).toBe(false);
  });

  it('a shape deleted mid-gesture cannot be dragged afterwards', () => {
    const { store, first } = withThree();

    const result = store.gesture((tx) => {
      tx.apply({ kind: 'delete', ids: [first] });
      return tx.apply({ kind: 'transform', entries: [{ id: first, t: at(99, 99) }] });
    });

    // The staged view has to reflect the drop, or a gesture composes against a shape it
    // already removed and resurrects it on commit.
    expect(result.value).toEqual({ ok: false, reason: 'unknown-shape' });
  });
});
