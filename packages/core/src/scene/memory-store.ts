import type { Command, RejectReason, ScenePeek } from '../commands/command.ts';
import type { Shape, ShapeId, ShapeKey } from '../schema/shape.ts';
import type {
  GestureResult,
  GestureTx,
  SceneDigest,
  SceneFault,
  SceneStore,
  Unsubscribe,
} from './store.ts';
import { missingTarget, stampShape } from '../commands/apply.ts';
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
  /** The value as staged, so a read mid-gesture composes against the gesture's own effects. */
  readonly shape: Shape;
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
  if (key !== 't') return notYet(`no-op suppression for '${key}'`, 'the restyle and reorder reds');
  const next = staged.t;
  const previous = committed.t;
  return (
    next.x !== previous.x ||
    next.y !== previous.y ||
    next.w !== previous.w ||
    next.h !== previous.h ||
    next.rot !== previous.rot
  );
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
const commitStaged = (staged: ReadonlyMap<ShapeId, Staged>, shapes: Map<ShapeId, Shape>): number => {
  let ops = 0;

  for (const entry of staged.values()) {
    if (entry.created) {
      shapes.set(entry.shape.id, entry.shape);
      ops += 1;
      continue;
    }

    const committed = shapes.get(entry.shape.id);
    let changed = 0;
    for (const key of entry.keys) {
      if (committed === undefined || differs(entry.shape, committed, key)) changed += 1;
    }

    // Left untouched rather than rewritten with an equal value: a suppressed gesture must
    // leave the scene exactly as it found it, object identity included, because that is what
    // the renderer's dirty tracking will be comparing against.
    if (changed === 0) continue;

    shapes.set(entry.shape.id, entry.shape);
    ops += changed;
  }

  return ops;
};

export const createMemoryStore = (options: MemoryStoreOptions): SceneStore => {
  const shapes = new Map<ShapeId, Shape>();

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
      const staged = new Map<ShapeId, Staged>();

      /** The scene as this gesture has left it so far, falling back to what is committed. */
      const peek = (id: ShapeId): Shape | undefined => staged.get(id)?.shape ?? shapes.get(id);

      const stage = (shape: Shape, key: ShapeKey): void => {
        const previous = staged.get(shape.id);
        staged.set(shape.id, {
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
          case 'restyle':
          case 'reorder':
          case 'delete':
            return notYet(`apply(${command.kind})`, 'the next red in PHASES.md Phase 1');
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
      const opCount = commitStaged(staged, shapes);

      return { value, committed: opCount > 0, opCount };
    },

    subscribe: (): Unsubscribe => notYet('subscribe', 'the first dirty-notification test'),

    drainFaults: (): readonly SceneFault[] => notYet('drainFaults', 'the first resolver test'),

    digest: (): SceneDigest => notYet('digest', 'the Phase 5 convergence probe'),

    stalled: () => notYet('stalled', 'the Phase 6 relay tests'),
  };
};
