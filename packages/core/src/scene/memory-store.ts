import type { Command, RejectReason, ScenePeek } from '../commands/command.ts';
import type { Shape, ShapeId, ShapeKey } from '../schema/shape.ts';
import type {
  DirtyListener,
  DirtyMask,
  DirtyView,
  GestureResult,
  GestureTx,
  Origin,
  SceneDigest,
  SceneFault,
  SceneStore,
  Unsubscribe,
} from './store.ts';
import { missingTarget, stampShape } from '../commands/apply.ts';
import { DIRTY_EXISTENCE, DIRTY_NONE, KEY_DIRTY, combine } from './dirty.ts';
import { compareDrawOrder } from './order.ts';

/**
 * The single-player scene store.
 *
 * First of the two implementations of {@link SceneStore}; `YjsStore` follows in Phase 5
 * behind the same interface. Nothing above the seam knows which it has, which is why the
 * convergence suite can drive the real command vocabulary with no browser and no CRDT.
 *
 * It holds resolved `Shape`s in a plain `Map`. It deliberately does **not** hold raw document
 * values with shapes as a derived cache: that layout costs measurably more time and memory,
 * and nothing in Phase 1 distinguishes it — it is justified only by the differential test in
 * Phase 5, so it belongs in Phase 5.
 */

/** Everything the store needs from outside itself. Both are injected, and both must be. */
export interface MemoryStoreOptions {
  /**
   * The user this store writes on behalf of. Stamped onto every shape, never read from a
   * caller's draft — `ShapeDraft` omits `author` so a forged one is unrepresentable.
   */
  readonly author: string;
  /**
   * Epoch millis. Injected because `Date.now()` is lint-banned in this package: a failing
   * property-suite seed has to reproduce exactly, and a hidden clock makes that impossible.
   */
  readonly now: () => number;
}

/**
 * Not yet demanded by a test.
 *
 * `SceneStore` requires these members to exist, so they cannot simply be absent — but every
 * possible body is an unasserted claim about behaviour. Throwing is the smallest correct one:
 * a stub returning `[]` or `undefined` would let a future caller silently get a wrong answer,
 * while this names the phase that will demand it.
 */
const notYet = (member: string, demandedBy: string): never => {
  throw new Error(`MemoryStore.${member} is not implemented yet — demanded by ${demandedBy}`);
};

/** What a staged command reports back. Refusal is a return value; a refused frame is normal. */
type ApplyOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: RejectReason };

/** One shape's staged state within a single gesture. */
interface Staged {
  /** Carried separately because a staged drop has no shape to read it from. */
  readonly id: ShapeId;
  /**
   * The value as staged, so a read mid-gesture composes against the gesture's own effects.
   * `undefined` when this gesture dropped the shape — which is what stops a later command in
   * the same gesture composing against a shape it has already removed.
   */
  readonly shape: Shape | undefined;
  /**
   * True when this gesture created the shape. A create is one whole-container `put`, so it
   * costs one write however many keys the rest of the gesture goes on to touch.
   */
  readonly created: boolean;
  /** Distinct keys written by `set` ops. One write per surviving key. */
  readonly keys: ReadonlySet<ShapeKey>;
}

/**
 * Whether one staged key still differs from what is committed.
 *
 * `t` is compared field by field because every frame arrives as a fresh object, so reference
 * equality would report every drag as a change — including one that ends where it began.
 *
 * The fields are compared with `===`, not `Object.is`, and the difference is load-bearing for
 * exactly one value: `Object.is(0, -0)` is false. A rotation that comes back to `-0` is the
 * same shape on screen, and calling it a change puts a struct on the wire and a Ctrl+Z that
 * visibly does nothing on the stack.
 */
const differs = (staged: Shape, committed: Shape, key: ShapeKey): boolean => {
  if (key === 't') {
    const next = staged.t;
    const previous = committed.t;
    return (
      next.x !== previous.x ||
      next.y !== previous.y ||
      next.w !== previous.w ||
      next.h !== previous.h ||
      next.rot !== previous.rot
    );
  }

  if (key === 'style') {
    const next = staged.style;
    const previous = committed.style;
    return (
      next.fill !== previous.fill ||
      next.stroke !== previous.stroke ||
      next.strokeWidth !== previous.strokeWidth ||
      next.opacity !== previous.opacity
    );
  }

  if (key === 'idx') return staged.idx !== committed.idx;

  // The remaining keys are `birth`: no command declares them in its footprint, so no `set`
  // can reach them and there is nothing to compare.
  return notYet(`no-op suppression for '${key}'`, 'a command that writes a birth key');
};

/**
 * Write the staged layer through, dropping keys that did not actually change, and report how
 * many writes that came to.
 *
 * The count mentions neither the frame count nor the gesture, only shapes and keys. That is
 * the entire point: a 300-frame drag and a 600-frame drag are the same single write, and a
 * cancelled drag is none. Counting per frame instead would mean a board gets slower to load
 * with every gesture anyone has ever made on it.
 */
interface Committed {
  readonly ops: number;
  /** Ids actually written, after suppression. What a listener is handed. */
  readonly ids: ReadonlySet<ShapeId>;
  /** OR of what the surviving writes invalidate - derived from the ops, never from the command. */
  readonly mask: DirtyMask;
}

const commitStaged = (staged: ReadonlyMap<ShapeId, Staged>, shapes: Map<ShapeId, Shape>): Committed => {
  let ops = 0;
  let mask = DIRTY_NONE;
  const ids = new Set<ShapeId>();

  for (const entry of staged.values()) {
    if (entry.shape === undefined) {
      // Nothing to drop means nothing happened: a shape drawn and deleted inside one gesture
      // was never committed, so it nets to zero writes and zero repaints — the same rule as a
      // drag that ends where it began, applied to existence instead of geometry.
      if (!shapes.delete(entry.id)) continue;
      ops += 1;
      ids.add(entry.id);
      mask = combine(mask, DIRTY_EXISTENCE);
      continue;
    }

    if (entry.created) {
      shapes.set(entry.shape.id, entry.shape);
      ops += 1;
      ids.add(entry.shape.id);
      mask = combine(mask, DIRTY_EXISTENCE);
      continue;
    }

    const committed = shapes.get(entry.shape.id);
    let changed = 0;
    let entryMask = DIRTY_NONE;
    for (const key of entry.keys) {
      if (committed !== undefined && !differs(entry.shape, committed, key)) continue;
      changed += 1;
      // Derived from the surviving op, never from the command that produced it. A drag that
      // returns home must not repaint, and a command-derived mask would repaint every time.
      entryMask = combine(entryMask, KEY_DIRTY[key]);
    }

    // Left untouched rather than rewritten with an equal value: a suppressed gesture must
    // leave the scene exactly as it found it, object identity included, because that is what
    // the renderer's dirty tracking will be comparing against.
    if (changed === 0) continue;

    shapes.set(entry.shape.id, entry.shape);
    ops += changed;
    ids.add(entry.shape.id);
    mask = combine(mask, entryMask);
  }

  return { ops, ids, mask };
};

/**
 * A dirty view that stops working the moment its notification returns.
 *
 * Every accessor is a getter behind one flag, rather than a plain object handed out and hoped
 * about. Retaining the view means reading a snapshot the next transaction has already
 * invalidated, and a renderer drawing from one draws a shape where it used to be with nothing
 * to notice. Four getters cover it because `DirtyView` has exactly four members.
 */
const revocableView = (
  mask: DirtyMask,
  ids: ReadonlySet<ShapeId>,
  origin: Origin,
): { readonly view: DirtyView; readonly revoke: () => void } => {
  let live = true;
  const read = <T>(value: () => T): T => {
    if (!live) {
      throw new Error(
        'DirtyView was read after its notification returned - the view is revoked. Copy the ' +
          'ids you need inside the listener; the snapshot behind it is already stale.',
      );
    }
    return value();
  };

  return {
    view: {
      get mask() {
        return read(() => mask);
      },
      get ids() {
        return read(() => ids);
      },
      get origin() {
        return read(() => origin);
      },
      get stalled() {
        // Single-player: no peers, so this replica can never hold unintegrated structs. The
        // field exists because the seam is shared with `YjsStore`, where it is the
        // causally-stalled state a sync indicator has to distinguish from offline.
        return read(() => false);
      },
    },
    revoke: () => {
      live = false;
    },
  };
};

export const createMemoryStore = (options: MemoryStoreOptions): SceneStore => {
  const shapes = new Map<ShapeId, Shape>();
  const listeners = new Set<DirtyListener>();
  let gestures = 0;
  let notifying = false;

  /**
   * Hand every listener one revoked-on-return view.
   *
   * `notifying` is what makes a write from inside a listener throw. A listener that repairs
   * the scene in response to a change nests one transaction inside another, and in `YjsStore`
   * that puts an undo step inside an undo step - so the refusal belongs here at the seam,
   * where both implementations inherit it, rather than in each one's transaction code.
   */
  const notify = (mask: DirtyMask, ids: ReadonlySet<ShapeId>, origin: Origin): void => {
    notifying = true;
    try {
      for (const listener of listeners) {
        const { view, revoke } = revocableView(mask, ids, origin);
        try {
          listener(view);
        } finally {
          revoke();
        }
      }
    } finally {
      notifying = false;
    }
  };

  return {
    get: (id) => shapes.get(id),

    has: (id) => shapes.has(id),

    /**
     * Shapes in draw order, sorted by `(idx, id)`.
     *
     * Never by insertion order: three byte-identical replicas iterate a document map in three
     * different orders, so any order derived from iteration renders differently per replica.
     */
    drawOrder: () => [...shapes.values()].sort(compareDrawOrder),

    query: () => notYet('query', 'the first culling test'),

    gesture: <T>(body: (tx: GestureTx) => T): GestureResult<T> => {
      if (notifying) {
        throw new Error(
          'gesture() was called from inside a dirty notification, which is a re-entrant ' +
            'write. A listener marks ids dirty and returns; schedule the write for after ' +
            'the frame.',
        );
      }

      const staged = new Map<ShapeId, Staged>();

      /**
       * The scene as this gesture has left it, falling back to what is committed.
       *
       * Not `staged.get(id)?.shape ?? shapes.get(id)`: a staged *drop* has an entry whose
       * shape is undefined, and the `??` would fall through to the committed value and
       * resurrect it.
       */
      const peek = (id: ShapeId): Shape | undefined => {
        const entry = staged.get(id);
        return entry === undefined ? shapes.get(id) : entry.shape;
      };

      const stage = (shape: Shape, key: ShapeKey): void => {
        const previous = staged.get(shape.id);
        staged.set(shape.id, {
          id: shape.id,
          shape,
          created: previous?.created ?? false,
          keys: new Set(previous === undefined ? [key] : [...previous.keys, key]),
        });
      };

      /**
       * The scene as this gesture has left it, in the shape a reducer expects.
       *
       * Staged-aware on purpose: a shape created earlier in the same gesture has to count as
       * present, or a create-then-drag would be refused for naming a shape it just made.
       */
      const stagedScene: ScenePeek = {
        get: peek,
        has: (id) => peek(id) !== undefined,
      };

      const applyCommand = (command: Command): ApplyOutcome => {
        // Refusal is decided by the shared reducer, never re-derived here. Two
        // implementations satisfy `SceneStore`, and one accepting a command the other refuses
        // is a divergence no digest catches: both replicas stay internally consistent and
        // hold different scenes.
        const missing = missingTarget(stagedScene, command);
        if (missing !== undefined) return { ok: false, reason: 'unknown-shape' };

        switch (command.kind) {
          case 'create': {
            staged.set(command.draft.id, {
              id: command.draft.id,
              shape: stampShape(command.draft, { author: options.author, at: options.now() }),
              created: true,
              keys: new Set(),
            });
            return { ok: true };
          }
          case 'transform': {
            // Every entry is resolved before anything is staged. A command reduces to one
            // patch, so a group drag naming one stale id refuses whole rather than moving the
            // rest of the selection and leaving the caller to guess which moved.
            const moved: Shape[] = [];
            for (const entry of command.entries) {
              const current = peek(entry.id);
              // Unreachable: `missingTarget` has already established every entry is present.
              // Kept because it is what narrows `Shape | undefined` without an assertion, and
              // an assertion here would be a claim the compiler cannot check.
              if (current === undefined) return { ok: false, reason: 'unknown-shape' };
              moved.push({ ...current, t: entry.t });
            }
            for (const shape of moved) stage(shape, 't');
            return { ok: true };
          }
          case 'restyle': {
            const restyled: Shape[] = [];
            for (const entry of command.entries) {
              const current = peek(entry.id);
              if (current === undefined) return { ok: false, reason: 'unknown-shape' };
              restyled.push({ ...current, style: entry.style });
            }
            for (const shape of restyled) stage(shape, 'style');
            return { ok: true };
          }
          case 'reorder': {
            const reordered: Shape[] = [];
            for (const entry of command.entries) {
              const current = peek(entry.id);
              if (current === undefined) return { ok: false, reason: 'unknown-shape' };
              reordered.push({ ...current, idx: entry.idx });
            }
            for (const shape of reordered) stage(shape, 'idx');
            return { ok: true };
          }
          case 'delete': {
            // A parent drop, so nothing per-key is staged: the whole container goes, which is
            // what beats a concurrent child write in both clientID directions.
            for (const id of command.ids) {
              staged.set(id, { id, shape: undefined, created: false, keys: new Set() });
            }
            return { ok: true };
          }
          default:
            return notYet('apply', 'an unhandled command kind');
        }
      };

      const tx: GestureTx = {
        apply: applyCommand,
        peek,
        // Untested, so unimplemented. An earlier draft tracked an `aborted` flag and lint
        // objected that both branches reading it were constant — which was a fair signal
        // rather than noise: nothing exercises the abort path, so the flag was decoration
        // and the honest answer is to say so until a test asks for Escape-cancels-a-drag.
        abort: () => notYet('gesture().abort', 'the Escape-cancels-a-gesture test'),
      };

      const value = body(tx);
      const { ops, ids, mask } = commitStaged(staged, shapes);

      gestures += 1;
      if (ops > 0) notify(mask, ids, { kind: 'local-gesture', gestureId: `g${gestures}` });

      return { value, committed: ops > 0, opCount: ops };
    },

    subscribe: (listener: DirtyListener): Unsubscribe => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    drainFaults: (): readonly SceneFault[] => notYet('drainFaults', 'the first resolver test'),

    digest: (): SceneDigest => notYet('digest', 'the Phase 5 convergence probe'),

    // Single-player: no peers, so no unintegrated structs. See the note in `revocableView`.
    stalled: () => false,
  };
};
