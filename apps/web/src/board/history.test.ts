import { describe as group, expect, it } from 'vitest';

import type { FracIdx, ShapeDraft, ShapeId, Style, Transform } from '@tessera/core';
import { createMemoryStore } from '@tessera/core';
import { createHistory } from './history.ts';

/**
 * Undo and redo, single-player.
 *
 * The describe names match the verifiers in PHASES.md (`-t "cancelled drag"`).
 *
 * The stack lives here in the interaction layer, not in the store: `SceneStore` deliberately
 * declares no undo member, because the multiplayer store defers to `Y.UndoManager` and a
 * same-named member with different semantics across the two stores is the footgun invariant 8
 * exists to stop. One committed gesture is one undo step; a gesture that committed nothing is
 * not a step at all.
 */

const draft = (id: string, x = 0, idx = 'a0'): ShapeDraft => ({
  id: id as ShapeId,
  kind: 'rect',
  t: { x, y: 0, w: 10, h: 10, rot: 0 } as unknown as Transform,
  idx: idx as FracIdx,
  style: { fill: '#2563eb', stroke: '#0f172a', strokeWidth: 1, opacity: 1 } as unknown as Style,
});

const moveTo = (x: number): Transform => ({ x, y: 0, w: 10, h: 10, rot: 0 }) as unknown as Transform;

const board = () => {
  const store = createMemoryStore({ author: 'u1', now: () => 0 });
  const history = createHistory(store);
  return { store, history };
};

group('cancelled drag', () => {
  it('leaves the undo stack alone, so Ctrl+Z undoes the gesture before it', () => {
    const { store, history } = board();
    const id = 'a' as ShapeId;
    history.perform([{ kind: 'create', draft: draft('a') }]);
    history.perform([{ kind: 'transform', entries: [{ id, t: moveTo(100) }] }]);

    // The user picks the shape up, moves it, and drops it back exactly where it was. The store
    // suppresses the write; the history must not record a step for it.
    const cancelled = history.perform([{ kind: 'transform', entries: [{ id, t: moveTo(100) }] }]);
    expect(cancelled.committed).toBe(false);
    expect(history.depth().undo).toBe(2);

    // Ctrl+Z undoes the MOVE, not the non-event.
    expect(history.undo()).toBe(true);
    expect(store.get(id)?.t.x).toBe(0);
  });
});

group('undo', () => {
  it('undoing a draw removes the shape, and redo brings it back', () => {
    const { store, history } = board();
    const id = 'a' as ShapeId;
    history.perform([{ kind: 'create', draft: draft('a') }]);

    expect(history.undo()).toBe(true);
    expect(store.has(id)).toBe(false);

    expect(history.redo()).toBe(true);
    expect(store.has(id)).toBe(true);
    expect(store.get(id)?.t.x).toBe(0);
  });

  it('undoing a move restores the previous position', () => {
    const { store, history } = board();
    const id = 'a' as ShapeId;
    history.perform([{ kind: 'create', draft: draft('a') }]);
    history.perform([{ kind: 'transform', entries: [{ id, t: moveTo(100) }] }]);
    history.perform([{ kind: 'transform', entries: [{ id, t: moveTo(250) }] }]);

    history.undo();
    expect(store.get(id)?.t.x).toBe(100);
    history.undo();
    expect(store.get(id)?.t.x).toBe(0);
  });

  it('undoing a delete of several shapes brings all of them back in one step', () => {
    // A multi-delete is one gesture, so it is one undo step — even though its inverse is
    // several creates. The history splits the deletion per id before asking for inverses.
    const { store, history } = board();
    history.perform([{ kind: 'create', draft: draft('a', 0, 'a0') }]);
    history.perform([{ kind: 'create', draft: draft('b', 50, 'a1') }]);
    history.perform([{ kind: 'delete', ids: ['a' as ShapeId, 'b' as ShapeId] }]);
    expect(store.drawOrder()).toHaveLength(0);

    expect(history.undo()).toBe(true);
    expect(store.drawOrder().map((s) => s.id)).toEqual(['a', 'b']);
    expect(store.get('b' as ShapeId)?.t.x).toBe(50);
  });

  it('a new gesture after an undo discards the redo branch', () => {
    const { store, history } = board();
    const id = 'a' as ShapeId;
    history.perform([{ kind: 'create', draft: draft('a') }]);
    history.perform([{ kind: 'transform', entries: [{ id, t: moveTo(100) }] }]);
    history.undo();

    history.perform([{ kind: 'transform', entries: [{ id, t: moveTo(7) }] }]);

    // Redo has nothing to redo: the move to 100 is on a branch the user left.
    expect(history.redo()).toBe(false);
    expect(store.get(id)?.t.x).toBe(7);
  });

  it('undo and redo with an empty stack do nothing and say so', () => {
    const { history } = board();

    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
    expect(history.depth()).toEqual({ undo: 0, redo: 0 });
  });

  it('undoing a move restores geometry exactly, including rotation', () => {
    const { store, history } = board();
    const id = 'a' as ShapeId;
    history.perform([{ kind: 'create', draft: draft('a') }]);
    const turned = { x: 0, y: 0, w: 10, h: 10, rot: 1.25 } as unknown as Transform;
    history.perform([{ kind: 'transform', entries: [{ id, t: turned }] }]);
    history.perform([{ kind: 'transform', entries: [{ id, t: moveTo(30) }] }]);

    history.undo();

    expect(store.get(id)?.t).toEqual(turned);
  });
});
