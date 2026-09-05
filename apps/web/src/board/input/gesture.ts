import type { Command, FracIdx, Rect, Shape, ShapeId, Style, Transform, Vec2 } from '@tessera/core';
import { finite } from '@tessera/core';

/**
 * The gesture state machine: pointer samples in, at most one command out, on release.
 *
 * Pure. It never sees an element, an event object or a canvas — the DOM adapter turns
 * `PointerEvent`s into board-space {@link Sample}s and calls {@link step}. That is what makes a
 * three-second drag at two frame rates assertable in a few milliseconds with no browser, and it
 * is what makes the transaction boundary a property of this file rather than of timing.
 *
 * **The in-flight gesture is tier-1 state, here, until release.** ARCHITECTURE §2: "the in-flight
 * drag offset … until pointerup". The overlay draws it from {@link Phase}; the store is told
 * nothing until `up`, and then exactly one command. So `4.C2` — one transaction for a
 * three-second drag — is true by construction, and the store's staging collapse is the second
 * line of defence rather than the first.
 */

export type Tool = 'select' | 'rect';

export interface Sample {
  /** Pointer position in board units, after the camera. */
  readonly board: Vec2;
  /** Event timestamp in ms. Carried so a future velocity model has it; unused today. */
  readonly t: number;
  readonly shift: boolean;
}

export type GestureEvent =
  | { readonly type: 'down'; readonly sample: Sample }
  | { readonly type: 'move'; readonly sample: Sample }
  | { readonly type: 'up'; readonly sample: Sample }
  /** Escape. Abandons whatever is in flight; nothing commits. */
  | { readonly type: 'cancel' }
  | { readonly type: 'key'; readonly key: 'Delete' }
  | { readonly type: 'tool'; readonly tool: Tool };

/** What the machine needs to know about the world. Everything here is a read or a mint. */
export interface GestureContext {
  readonly get: (id: ShapeId) => Shape | undefined;
  /** Topmost shape under a board point, with the caller's slop already applied. */
  readonly hit: (point: Vec2) => ShapeId | undefined;
  /** Shapes intersecting a board rect, for the marquee. */
  readonly shapesIn: (rect: Rect) => readonly ShapeId[];
  readonly nextId: () => ShapeId;
  /** An index above everything on the board, so a new shape lands on top. */
  readonly nextIdx: () => FracIdx;
  /**
   * How far the pointer must travel, in board units, before a press becomes a drag. Zoom
   * dependent — the adapter converts a few CSS px — so it is supplied rather than fixed.
   */
  readonly dragThreshold?: number;
}

/** A press that has not yet decided whether it is a click or a drag. */
interface Pressing {
  readonly kind: 'pressing';
  readonly origin: Vec2;
  readonly hit: ShapeId | undefined;
  readonly shift: boolean;
}

/** Moving the selection. `origins` are the geometries at press time; the commit is origin + delta. */
interface Dragging {
  readonly kind: 'dragging';
  readonly origin: Vec2;
  readonly current: Vec2;
  readonly origins: readonly { readonly id: ShapeId; readonly t: Transform }[];
}

interface Marquee {
  readonly kind: 'marquee';
  readonly origin: Vec2;
  readonly current: Vec2;
  readonly shift: boolean;
}

interface Drawing {
  readonly kind: 'drawing';
  readonly origin: Vec2;
  readonly current: Vec2;
}

export type Phase = { readonly kind: 'idle' } | Pressing | Dragging | Marquee | Drawing;

export interface GestureState {
  readonly tool: Tool;
  readonly selection: readonly ShapeId[];
  readonly phase: Phase;
}

export const IDLE: GestureState = { tool: 'select', selection: [], phase: { kind: 'idle' } };

export interface Step {
  readonly state: GestureState;
  /** At most one, and only ever on `up` or `Delete`. */
  readonly commit: Command | undefined;
}

const DEFAULT_DRAG_THRESHOLD = 2;

/** What a new rectangle wears. One palette entry, so drawn shapes match the seeded fixture. */
const NEW_RECT_STYLE: Style = {
  fill: '#2563eb',
  stroke: '#0f172a',
  strokeWidth: finite(1.5),
  opacity: finite(1),
};

/** The axis-aligned box between two corners, normalised so a drag up-left is not negative. */
export const boxBetween = (a: Vec2, b: Vec2): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  h: Math.abs(b.y - a.y),
});

const idle = (state: GestureState, selection = state.selection): GestureState => ({
  ...state,
  selection,
  phase: { kind: 'idle' },
});

const nothing = (state: GestureState): Step => ({ state, commit: undefined });

const farEnough = (from: Vec2, to: Vec2, threshold: number): boolean =>
  Math.abs(to.x - from.x) >= threshold || Math.abs(to.y - from.y) >= threshold;

/** Shift adds to a selection; without it, the click replaces it. Never duplicates an id. */
const select = (selection: readonly ShapeId[], id: ShapeId, shift: boolean): readonly ShapeId[] => {
  if (!shift) return [id];
  return selection.includes(id) ? selection : [...selection, id];
};

/**
 * A press resolves into a drag. The pressed shape joins the selection first if it was not
 * already in it — so dragging an unselected shape moves that shape, and dragging one shape of a
 * selection moves the whole selection — and every selected shape's geometry is captured now,
 * because the commit is origin plus delta and the origin is only known here.
 */
const beginDrag = (
  state: GestureState,
  phase: Pressing,
  hit: ShapeId,
  current: Vec2,
  ctx: GestureContext,
): GestureState => {
  const selection = state.selection.includes(hit) ? state.selection : select(state.selection, hit, phase.shift);
  const origins = selection.flatMap((id) => {
    const shape = ctx.get(id);
    return shape === undefined ? [] : [{ id, t: shape.t }];
  });
  // `current` is the sample that crossed the threshold, not the press origin. The first draft
  // used the origin, so a drag's first frame showed the ghost at zero offset — invisible with
  // 180 samples, and a real bug with one.
  return { ...state, selection, phase: { kind: 'dragging', origin: phase.origin, current, origins } };
};

/** The one command a drag produces: every origin, shifted by the total delta. */
const commitDrag = (phase: Dragging, to: Vec2): Command | undefined => {
  const dx = to.x - phase.origin.x;
  const dy = to.y - phase.origin.y;
  const [first, ...rest] = phase.origins.map(({ id, t }) => ({
    id,
    t: { ...t, x: finite(t.x + dx), y: finite(t.y + dy) },
  }));
  if (first === undefined) return undefined;
  return { kind: 'transform', entries: [first, ...rest] };
};

const commitDraw = (phase: Drawing, to: Vec2, threshold: number, ctx: GestureContext): Command | undefined => {
  const box = boxBetween(phase.origin, to);
  // Pressing without moving is not a rectangle. Without this every stray click with the tool
  // active litters the board with invisible zero-size shapes.
  if (box.w < threshold || box.h < threshold) return undefined;
  return {
    kind: 'create',
    draft: {
      id: ctx.nextId(),
      kind: 'rect',
      t: { x: finite(box.x), y: finite(box.y), w: finite(box.w), h: finite(box.h), rot: finite(0) },
      idx: ctx.nextIdx(),
      style: NEW_RECT_STYLE,
    },
  };
};

const onDown = (state: GestureState, sample: Sample, ctx: GestureContext): Step => {
  if (state.tool === 'rect') {
    return nothing({ ...state, phase: { kind: 'drawing', origin: sample.board, current: sample.board } });
  }
  // A press decides nothing yet. Whether it was a click or the start of a drag is only known
  // once the pointer has moved, or released without moving.
  return nothing({
    ...state,
    phase: { kind: 'pressing', origin: sample.board, hit: ctx.hit(sample.board), shift: sample.shift },
  });
};

const onMove = (state: GestureState, sample: Sample, ctx: GestureContext): Step => {
  const { phase } = state;
  const threshold = ctx.dragThreshold ?? DEFAULT_DRAG_THRESHOLD;

  switch (phase.kind) {
    case 'pressing': {
      if (!farEnough(phase.origin, sample.board, threshold)) return nothing(state);
      if (phase.hit !== undefined) return nothing(beginDrag(state, phase, phase.hit, sample.board, ctx));
      return nothing({
        ...state,
        phase: { kind: 'marquee', origin: phase.origin, current: sample.board, shift: phase.shift },
      });
    }
    case 'dragging':
    case 'marquee':
    case 'drawing':
      return nothing({ ...state, phase: { ...phase, current: sample.board } });
    case 'idle':
      return nothing(state);
  }
};

const onUp = (state: GestureState, sample: Sample, ctx: GestureContext): Step => {
  const { phase } = state;
  const threshold = ctx.dragThreshold ?? DEFAULT_DRAG_THRESHOLD;

  switch (phase.kind) {
    case 'pressing': {
      // A click. On a shape it selects; on the board it clears — unless shift is held, in
      // which case a stray shift-click on empty space keeps what the user has built up.
      if (phase.hit !== undefined) return nothing(idle(state, select(state.selection, phase.hit, phase.shift)));
      return nothing(idle(state, phase.shift ? state.selection : []));
    }
    case 'dragging':
      return { state: idle(state), commit: commitDrag(phase, sample.board) };
    case 'marquee': {
      const crossed = ctx.shapesIn(boxBetween(phase.origin, sample.board));
      const selection = phase.shift
        ? [...state.selection, ...crossed.filter((id) => !state.selection.includes(id))]
        : crossed;
      return nothing(idle(state, selection));
    }
    case 'drawing': {
      const commit = commitDraw(phase, sample.board, threshold, ctx);
      // The new shape is selected, so the next drag moves it without an extra click.
      const selection = commit?.kind === 'create' ? [commit.draft.id] : state.selection;
      return { state: idle(state, selection), commit };
    }
    case 'idle':
      // A release with nothing in flight — after an Escape, or a pointer that went down
      // somewhere else. Ignored, and never turned into a commit.
      return nothing(state);
  }
};

const onDelete = (state: GestureState): Step => {
  if (state.phase.kind !== 'idle') return nothing(state);
  const [first, ...rest] = state.selection;
  if (first === undefined) return nothing(state);
  return { state: idle(state, []), commit: { kind: 'delete', ids: [first, ...rest] } };
};

/**
 * Advance the machine by one event.
 *
 * Every branch returns either no command or exactly one, and a command only ever leaves on `up`
 * or on `Delete`. There is no path from a `move` to a commit, which is the whole point.
 */
export const step = (state: GestureState, event: GestureEvent, ctx: GestureContext): Step => {
  switch (event.type) {
    case 'down':
      return onDown(state, event.sample, ctx);
    case 'move':
      return onMove(state, event.sample, ctx);
    case 'up':
      return onUp(state, event.sample, ctx);
    case 'cancel':
      // Whatever was in flight is abandoned. The selection survives — cancelling a drag should
      // not also deselect what you were dragging.
      return nothing(idle(state));
    case 'key':
      return onDelete(state);
    case 'tool':
      // Changing tool mid-gesture cancels the gesture. Finishing a select-drag with the rect
      // tool active would commit a move nobody can see the end of.
      return nothing({ ...idle(state), tool: event.tool });
  }
};
