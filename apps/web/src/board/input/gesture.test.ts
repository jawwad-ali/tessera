import { describe as group, expect, it } from 'vitest';

import type { Command, FracIdx, Shape, ShapeId, Style, Transform } from '@tessera/core';
import type { GestureContext, GestureState } from './gesture.ts';
import { IDLE, step } from './gesture.ts';

/**
 * The gesture state machine, driven with synthetic samples.
 *
 * The describe names match the verifiers in PHASES.md (`-t "one transaction"`).
 *
 * Every pointer event is already a board-space sample here: the DOM adapter does the
 * `getCoalescedEvents` and camera work, and this machine never sees an element. That is what
 * lets a three-second drag at two frame rates be asserted in a few milliseconds with no
 * browser — and it is where the tracker says the multi-evening bugs live, so it is where the
 * tests are.
 */

const rect = (id: string, x: number, y: number, idx = 'a0'): Shape => ({
  id: id as ShapeId,
  v: 1,
  kind: 'rect',
  t: { x, y, w: 40, h: 30, rot: 0 } as unknown as Transform,
  idx: idx as FracIdx,
  author: 'u1',
  style: { fill: '#2563eb', stroke: '#0f172a', strokeWidth: 1.5, opacity: 1 } as unknown as Style,
});

/** A tiny scene: `a` at the origin, `b` far away, and hit-testing by bounding box. */
const scene = (shapes: readonly Shape[] = [rect('a', 0, 0), rect('b', 500, 500, 'a1')]): GestureContext => {
  const byId = new Map(shapes.map((s) => [s.id, s]));
  let minted = 0;
  return {
    get: (id) => byId.get(id),
    hit: (p) =>
      [...byId.values()]
        .reverse()
        .find((s) => p.x >= s.t.x && p.x <= s.t.x + s.t.w && p.y >= s.t.y && p.y <= s.t.y + s.t.h)?.id,
    shapesIn: (r) =>
      [...byId.values()]
        .filter((s) => s.t.x < r.x + r.w && s.t.x + s.t.w > r.x && s.t.y < r.y + r.h && s.t.y + s.t.h > r.y)
        .map((s) => s.id),
    nextId: () => {
      minted += 1;
      return `new-${minted}` as ShapeId;
    },
    nextIdx: () => 'zz' as FracIdx,
  };
};

const at = (x: number, y: number, t = 0, shift = false) => ({ board: { x, y }, t, shift });

/** Run a whole drag through the machine and collect every command it emits. */
const drag = (
  ctx: GestureContext,
  start: GestureState,
  from: { x: number; y: number },
  to: { x: number; y: number },
  samples: number,
  durationMs: number,
): { state: GestureState; commits: Command[] } => {
  const commits: Command[] = [];
  let state = start;
  const push = (result: { state: GestureState; commit: Command | undefined }): void => {
    state = result.state;
    if (result.commit !== undefined) commits.push(result.commit);
  };

  push(step(state, { type: 'down', sample: at(from.x, from.y, 0) }, ctx));
  for (let n = 1; n <= samples; n++) {
    const f = n / samples;
    const t = (durationMs * n) / samples;
    push(step(state, { type: 'move', sample: at(from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f, t) }, ctx));
  }
  push(step(state, { type: 'up', sample: at(to.x, to.y, durationMs) }, ctx));
  return { state, commits };
};

group('one transaction', () => {
  it('a three-second drag at 60Hz commits exactly once, with the final geometry', () => {
    const { commits } = drag(scene(), IDLE, { x: 10, y: 10 }, { x: 210, y: 60 }, 180, 3_000);

    // Not one per frame. 180 pointer samples, one command, and it carries where the shape
    // ended up — the in-flight positions were tier-1 state the overlay drew and nobody stored.
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({
      kind: 'transform',
      entries: [{ id: 'a', t: { x: 200, y: 50, w: 40, h: 30, rot: 0 } }],
    });
  });

  it('the same drag at 120Hz is still exactly one commit', () => {
    // "At any frame rate" is asserted, not assumed: a machine that committed on a timer or on
    // every Nth sample would pass at one rate and fail at another.
    const { commits } = drag(scene(), IDLE, { x: 10, y: 10 }, { x: 210, y: 60 }, 360, 3_000);

    expect(commits).toHaveLength(1);
    expect(commits[0]?.kind).toBe('transform');
  });

  it('dragging a multi-selection is one command with one entry per shape', () => {
    const ctx = scene();
    const both: GestureState = { ...IDLE, selection: ['a' as ShapeId, 'b' as ShapeId] };

    // Grab `a`, which is part of the selection, and move everything.
    const { commits } = drag(ctx, both, { x: 10, y: 10 }, { x: 110, y: 10 }, 30, 500);

    expect(commits).toHaveLength(1);
    const cmd = commits[0];
    expect(cmd?.kind === 'transform' ? cmd.entries.map((e) => [e.id, e.t.x]) : undefined).toEqual([
      ['a', 100],
      ['b', 600],
    ]);
  });

  it('the move that starts the drag already carries its own offset', () => {
    // Found by the controller test, not by these: a single move past the threshold left the
    // drag's current position at the press origin, so the first ghost frame sat at zero offset.
    const ctx = scene();
    const down = step(IDLE, { type: 'down', sample: at(10, 10) }, ctx);
    const move = step(down.state, { type: 'move', sample: at(60, 10, 16) }, ctx);

    expect(move.state.phase.kind).toBe('dragging');
    expect(move.state.phase.kind === 'dragging' ? move.state.phase.current : undefined).toEqual({ x: 60, y: 10 });
  });

  it('returns to idle after the commit, with the moved shape still selected', () => {
    const { state } = drag(scene(), IDLE, { x: 10, y: 10 }, { x: 110, y: 10 }, 10, 200);

    expect(state.phase.kind).toBe('idle');
    expect(state.selection).toEqual(['a']);
  });
});

group('selecting', () => {
  it('a click on a shape selects it and commits nothing', () => {
    const ctx = scene();
    const down = step(IDLE, { type: 'down', sample: at(10, 10) }, ctx);
    const up = step(down.state, { type: 'up', sample: at(10, 10, 80) }, ctx);

    expect(up.commit).toBeUndefined();
    expect(up.state.selection).toEqual(['a']);
  });

  it('a click on empty board clears the selection', () => {
    const ctx = scene();
    const selected: GestureState = { ...IDLE, selection: ['a' as ShapeId] };
    const down = step(selected, { type: 'down', sample: at(300, 300) }, ctx);
    const up = step(down.state, { type: 'up', sample: at(300, 300, 80) }, ctx);

    expect(up.state.selection).toEqual([]);
  });

  it('shift-click adds to the selection instead of replacing it', () => {
    const ctx = scene();
    const selected: GestureState = { ...IDLE, selection: ['a' as ShapeId] };
    const down = step(selected, { type: 'down', sample: at(510, 510, 0, true) }, ctx);
    const up = step(down.state, { type: 'up', sample: at(510, 510, 80, true) }, ctx);

    expect(up.state.selection).toEqual(['a', 'b']);
  });

  it('a marquee from empty board selects everything it crosses, and commits nothing', () => {
    // Down on nothing, drag a box over `a`, release. A marquee is a selection gesture, not a
    // write: the store never hears about it.
    const { state, commits } = drag(scene(), IDLE, { x: -10, y: -10 }, { x: 60, y: 60 }, 20, 400);

    expect(commits).toEqual([]);
    expect(state.selection).toEqual(['a']);
    expect(state.phase.kind).toBe('idle');
  });

  it('a marquee dragged up-left still selects', () => {
    // The rect is normalised before the query. Without that a marquee drawn from the
    // bottom-right corner has negative width and selects nothing — a bug this repo has already
    // fixed once, at the spatial-hash boundary.
    const { state } = drag(scene(), IDLE, { x: 60, y: 60 }, { x: -10, y: -10 }, 20, 400);

    expect(state.selection).toEqual(['a']);
  });
});

group('drawing', () => {
  it('dragging with the rect tool creates one rectangle on release', () => {
    const ctx = scene([]);
    const rectTool: GestureState = { ...IDLE, tool: 'rect' };

    const { commits, state } = drag(ctx, rectTool, { x: 100, y: 100 }, { x: 160, y: 140 }, 15, 300);

    expect(commits).toHaveLength(1);
    const cmd = commits[0];
    expect(cmd?.kind).toBe('create');
    const draft = cmd?.kind === 'create' ? cmd.draft : undefined;
    expect(draft?.id).toBe('new-1');
    expect(draft?.kind).toBe('rect');
    expect(draft?.t).toEqual({ x: 100, y: 100, w: 60, h: 40, rot: 0 });
    expect(draft?.idx).toBe('zz');
    // Any fill will do; what matters is that a drawn shape is not invisible against the board.
    expect(draft?.style.fill).not.toBe('#ffffff');
    // The new shape is selected, so the next drag moves it without an extra click.
    expect(state.selection).toEqual(['new-1']);
  });

  it('a rectangle drawn up-left is normalised, never negative', () => {
    const rectTool: GestureState = { ...IDLE, tool: 'rect' };

    const { commits } = drag(scene([]), rectTool, { x: 160, y: 140 }, { x: 100, y: 100 }, 15, 300);

    const cmd = commits[0];
    expect(cmd?.kind === 'create' ? cmd.draft.t : undefined).toEqual({ x: 100, y: 100, w: 60, h: 40, rot: 0 });
  });

  it('a click with the rect tool draws nothing', () => {
    // Pressing without moving is not a rectangle. Without this every stray click with the tool
    // active litters the board with invisible zero-size shapes.
    const rectTool: GestureState = { ...IDLE, tool: 'rect' };

    const { commits } = drag(scene([]), rectTool, { x: 100, y: 100 }, { x: 101, y: 100 }, 1, 50);

    expect(commits).toEqual([]);
  });
});

group('cancelling and deleting', () => {
  it('Escape during a drag abandons it: nothing commits, the shape stays where it was', () => {
    const ctx = scene();
    let result = step(IDLE, { type: 'down', sample: at(10, 10) }, ctx);
    result = step(result.state, { type: 'move', sample: at(110, 10, 100) }, ctx);
    result = step(result.state, { type: 'cancel' }, ctx);

    expect(result.commit).toBeUndefined();
    expect(result.state.phase.kind).toBe('idle');

    // And a pointerup arriving after the cancel is ignored, not turned into a commit.
    const up = step(result.state, { type: 'up', sample: at(110, 10, 120) }, ctx);
    expect(up.commit).toBeUndefined();
  });

  it('Delete removes the whole selection in one command', () => {
    const selected: GestureState = { ...IDLE, selection: ['a' as ShapeId, 'b' as ShapeId] };

    const result = step(selected, { type: 'key', key: 'Delete' }, scene());

    expect(result.commit).toEqual({ kind: 'delete', ids: ['a', 'b'] });
    expect(result.state.selection).toEqual([]);
  });

  it('Delete with nothing selected does nothing', () => {
    expect(step(IDLE, { type: 'key', key: 'Delete' }, scene()).commit).toBeUndefined();
  });

  it('switching tool mid-gesture cancels the gesture', () => {
    const ctx = scene();
    let result = step(IDLE, { type: 'down', sample: at(10, 10) }, ctx);
    result = step(result.state, { type: 'move', sample: at(60, 10, 50) }, ctx);
    result = step(result.state, { type: 'tool', tool: 'rect' }, ctx);

    expect(result.commit).toBeUndefined();
    expect(result.state.phase.kind).toBe('idle');
    expect(result.state.tool).toBe('rect');
  });
});
