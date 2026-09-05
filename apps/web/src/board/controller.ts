import type { GestureResult, Rect, SceneStore, Shape, ShapeId, Vec2 } from '@tessera/core';
import { finite, idxBetween, rectsIntersect, selectionBounds, transformBounds } from '@tessera/core';
import { hitTest } from './hit.ts';
import { createHistory, type History } from './history.ts';
import { boxBetween, IDLE, step, type GestureEvent, type GestureState, type Tool } from './input/gesture.ts';
import type { OverlayView } from './render/overlay-layer.ts';

/**
 * The board controller: one object that owns the gesture state, the history and the store, and
 * turns the machine's commits into gestures.
 *
 * It has no DOM. The pointer adapter feeds it board-space events, the React toolbar reads a
 * snapshot through `useSyncExternalStore`, and the canvases ask it what to paint. Keeping it
 * free of React and of elements is what lets a whole draw-select-drag-undo sequence be tested
 * in node, which is where the tracker says the multi-evening bugs live.
 */

export interface ControllerSnapshot {
  readonly tool: Tool;
  readonly selection: readonly ShapeId[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface ControllerOptions {
  /** Hit slop in board units — the adapter converts 10 CSS px by the zoom. */
  readonly slop: () => number;
  readonly nextId: () => ShapeId;
  /** Entropy for index jitter. `Math.random` in the app; seeded in tests. */
  readonly rng: () => number;
  /** Every completed gesture, for the bench sink behind `4.C1`. */
  readonly onGesture?: (result: GestureResult<void>) => void;
}

export interface BoardController {
  readonly store: SceneStore;
  readonly history: History;
  readonly getSnapshot: () => ControllerSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispatch: (event: GestureEvent) => void;
  readonly setTool: (tool: Tool) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  /** Ids in flight, for the static layer to skip while the overlay draws them. */
  readonly dragging: () => ReadonlySet<ShapeId>;
  /** What the overlay paints right now. */
  readonly overlay: () => OverlayView;
}

/**
 * Ghosts: the dragged shapes at origin plus delta, in board space.
 *
 * Read from the store, which still holds every dragged shape at its committed position until
 * pointerup — the ghost is that shape with its geometry offset, and nothing else about it
 * changes. The origins captured at press time supply the geometry; the store supplies the rest.
 */
const ghostsOf = (store: SceneStore, state: GestureState, current: Vec2): readonly Shape[] => {
  const { phase } = state;
  if (phase.kind !== 'dragging') return [];
  const dx = current.x - phase.origin.x;
  const dy = current.y - phase.origin.y;
  return phase.origins.flatMap(({ id, t }) => {
    const shape = store.get(id);
    if (shape === undefined) return [];
    return [{ ...shape, t: { ...t, x: finite(t.x + dx), y: finite(t.y + dy) } }];
  });
};

export const createController = (store: SceneStore, options: ControllerOptions): BoardController => {
  const history = createHistory(store);
  const listeners = new Set<() => void>();
  let state: GestureState = IDLE;
  let snapshot: ControllerSnapshot = { tool: 'select', selection: [], canUndo: false, canRedo: false };

  /** Snapshot identity only changes when its contents do, so React does not re-render per move. */
  const refresh = (): void => {
    const depth = history.depth();
    const next: ControllerSnapshot = {
      tool: state.tool,
      selection: state.selection,
      canUndo: depth.undo > 0,
      canRedo: depth.redo > 0,
    };
    const same =
      next.tool === snapshot.tool &&
      next.selection === snapshot.selection &&
      next.canUndo === snapshot.canUndo &&
      next.canRedo === snapshot.canRedo;
    if (!same) snapshot = next;
    for (const listener of listeners) listener();
  };

  const shapesIn = (rect: Rect): readonly ShapeId[] => {
    const found: ShapeId[] = [];
    for (const id of store.query(rect)) {
      const shape = store.get(id);
      if (shape !== undefined && rectsIntersect(transformBounds(shape.t), rect)) found.push(id);
    }
    return found;
  };

  const context = {
    get: (id: ShapeId) => store.get(id),
    hit: (point: Vec2) => hitTest(store, point, options.slop()),
    shapesIn,
    nextId: options.nextId,
    // Above everything on the board, so a new shape lands on top of what is already there.
    nextIdx: () => idxBetween(store.drawOrder().at(-1)?.idx, undefined, options.rng),
  };

  const dispatch = (event: GestureEvent): void => {
    // The threshold is read per event, not once: zoom changes between gestures, and half the
    // hit slop is a press that has moved far enough to mean a drag at any zoom.
    const result = step(state, event, { ...context, dragThreshold: options.slop() / 2 });
    state = result.state;
    if (result.commit !== undefined) {
      const outcome = history.perform([result.commit]);
      options.onGesture?.(outcome);
    }
    refresh();
  };

  return {
    store,
    history,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    setTool: (tool) => {
      dispatch({ type: 'tool', tool });
    },
    undo: () => {
      history.undo();
      refresh();
    },
    redo: () => {
      history.redo();
      refresh();
    },
    dragging: () => new Set(state.phase.kind === 'dragging' ? state.phase.origins.map((o) => o.id) : []),
    overlay: () => {
      const { phase } = state;
      return {
        selection:
          phase.kind === 'dragging'
            ? undefined
            : selectionBounds({ get: (id) => store.get(id), has: (id) => store.has(id) }, state.selection),
        marquee: phase.kind === 'marquee' ? boxBetween(phase.origin, phase.current) : undefined,
        ghosts: phase.kind === 'dragging' ? ghostsOf(store, state, phase.current) : [],
      };
    },
  };
};
