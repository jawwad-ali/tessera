import { describe as group, expect, it } from 'vitest';

import type { FracIdx, GestureResult, ShapeDraft, ShapeId, Style, Transform } from '@tessera/core';
import { createMemoryStore } from '@tessera/core';
import { createController } from './controller.ts';

/**
 * The controller, driven end to end without a DOM.
 *
 * The describe name matches the verifier in PHASES.md (`-t controller`).
 *
 * Draw, select, drag, undo — the whole single-player loop — in node. This is the seam the
 * pointer adapter and the React toolbar both sit on, so it is where "the gesture staging
 * contract survives contact with real pointer events" is first put to the test, one layer
 * below the events themselves.
 */

const draft = (id: string, x: number, y: number, idx = 'a0'): ShapeDraft => ({
  id: id as ShapeId,
  kind: 'rect',
  t: { x, y, w: 40, h: 30, rot: 0 } as unknown as Transform,
  idx: idx as FracIdx,
  style: { fill: '#2563eb', stroke: '#0f172a', strokeWidth: 1, opacity: 1 } as unknown as Style,
});

const at = (x: number, y: number, shift = false) => ({ board: { x, y }, t: 0, shift });

const board = () => {
  const store = createMemoryStore({ author: 'u1', now: () => 0 });
  store.gesture((tx) => {
    tx.apply({ kind: 'create', draft: draft('a', 0, 0) });
  });
  const gestures: GestureResult<void>[] = [];
  let minted = 0;
  const controller = createController(store, {
    slop: () => 4,
    nextId: () => {
      minted += 1;
      return `n${minted}` as ShapeId;
    },
    rng: () => 0.5,
    onGesture: (result) => gestures.push(result),
  });
  return { store, controller, gestures };
};

group('controller', () => {
  it('a drag moves the shape, records one undo step, and reports one write', () => {
    const { store, controller, gestures } = board();

    controller.dispatch({ type: 'down', sample: at(10, 10) });
    for (let n = 1; n <= 60; n++) controller.dispatch({ type: 'move', sample: at(10 + n * 2, 10) });
    controller.dispatch({ type: 'up', sample: at(130, 10) });

    expect(store.get('a' as ShapeId)?.t.x).toBe(120);
    expect(controller.getSnapshot()).toEqual({ tool: 'select', selection: ['a'], canUndo: true, canRedo: false });
    // What 4.C1 reads back in the browser: the drag was one gesture, one write.
    expect(gestures).toHaveLength(1);
    expect(gestures[0]).toMatchObject({ committed: true, opCount: 1 });
  });

  it('exposes the in-flight drag for the two canvases, then clears it', () => {
    const { controller } = board();

    controller.dispatch({ type: 'down', sample: at(10, 10) });
    controller.dispatch({ type: 'move', sample: at(60, 10) });

    // The static layer skips the shape; the overlay paints its ghost at the offset position.
    expect([...controller.dragging()]).toEqual(['a']);
    expect(controller.overlay().ghosts.map((g) => g.t.x)).toEqual([50]);
    expect(controller.overlay().selection).toBeUndefined();

    controller.dispatch({ type: 'up', sample: at(60, 10) });
    expect(controller.dragging().size).toBe(0);
    expect(controller.overlay().ghosts).toEqual([]);
    // Handles come back around the moved shape.
    expect(controller.overlay().selection).toEqual({ x: 50, y: 0, w: 40, h: 30 });
  });

  it('draws a rectangle with the rect tool and selects it', () => {
    const { store, controller } = board();
    controller.setTool('rect');

    controller.dispatch({ type: 'down', sample: at(100, 100) });
    controller.dispatch({ type: 'move', sample: at(180, 150) });
    controller.dispatch({ type: 'up', sample: at(180, 150) });

    expect(store.has('n1' as ShapeId)).toBe(true);
    expect(store.get('n1' as ShapeId)?.t).toEqual({ x: 100, y: 100, w: 80, h: 50, rot: 0 });
    expect(controller.getSnapshot().selection).toEqual(['n1']);
    // On top of what was already there.
    expect(store.drawOrder().map((s) => s.id)).toEqual(['a', 'n1']);
  });

  it('a marquee selects what it crosses and shows while it is drawn', () => {
    const { controller } = board();

    controller.dispatch({ type: 'down', sample: at(-20, -20) });
    controller.dispatch({ type: 'move', sample: at(20, 20) });
    expect(controller.overlay().marquee).toEqual({ x: -20, y: -20, w: 40, h: 40 });

    controller.dispatch({ type: 'up', sample: at(20, 20) });
    expect(controller.getSnapshot().selection).toEqual(['a']);
    expect(controller.overlay().marquee).toBeUndefined();
  });

  it('undo after a drag puts the shape back and redo moves it again', () => {
    const { store, controller } = board();
    controller.dispatch({ type: 'down', sample: at(10, 10) });
    controller.dispatch({ type: 'move', sample: at(110, 10) });
    controller.dispatch({ type: 'up', sample: at(110, 10) });

    controller.undo();
    expect(store.get('a' as ShapeId)?.t.x).toBe(0);
    expect(controller.getSnapshot().canRedo).toBe(true);

    controller.redo();
    expect(store.get('a' as ShapeId)?.t.x).toBe(100);
  });

  it('does not change the snapshot identity for a move that changes nothing visible to React', () => {
    // 300 pointer moves per drag; React must not re-render the toolbar 300 times.
    const { controller } = board();
    controller.dispatch({ type: 'down', sample: at(10, 10) });
    controller.dispatch({ type: 'move', sample: at(20, 10) });
    const before = controller.getSnapshot();
    controller.dispatch({ type: 'move', sample: at(30, 10) });
    controller.dispatch({ type: 'move', sample: at(40, 10) });

    expect(controller.getSnapshot()).toBe(before);
  });

  it('Delete removes the selection and is undoable', () => {
    const { store, controller } = board();
    controller.dispatch({ type: 'down', sample: at(10, 10) });
    controller.dispatch({ type: 'up', sample: at(10, 10) });
    expect(controller.getSnapshot().selection).toEqual(['a']);

    controller.dispatch({ type: 'key', key: 'Delete' });
    expect(store.has('a' as ShapeId)).toBe(false);

    controller.undo();
    expect(store.has('a' as ShapeId)).toBe(true);
  });
});
