import type { Command, RejectReason } from '../commands/command.ts';
import type { Shape, ShapeId } from '../schema/shape.ts';
import type {
  GestureResult,
  GestureTx,
  SceneDigest,
  SceneFault,
  SceneStore,
  Unsubscribe,
} from './store.ts';
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

/** The schema version this store stamps on shapes it creates. */
const SCHEMA_VERSION = 1;

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

export const createMemoryStore = (options: MemoryStoreOptions): SceneStore => {
  const shapes = new Map<ShapeId, Shape>();

  /**
   * Apply one command, returning how many shapes it wrote.
   *
   * A create is **one** write, not one per field: at the document boundary it is a single
   * whole-map `put` at the root key, which is what makes two clients creating the same id
   * converge on one shape rather than a mixture of both.
   */
  const applyCommand = (
    command: Command,
  ): { readonly ok: true; readonly writes: number } | { readonly ok: false; readonly reason: RejectReason } => {
    switch (command.kind) {
      case 'create': {
        const { draft } = command;
        // The stamp is the store's, not the caller's. `author` and `v` are added here and
        // nowhere else.
        shapes.set(draft.id, { ...draft, author: options.author, v: SCHEMA_VERSION });
        return { ok: true, writes: 1 };
      }
      case 'transform':
      case 'restyle':
      case 'reorder':
      case 'delete':
        return notYet(`apply(${command.kind})`, 'the next red in PHASES.md Phase 1');
      default:
        return notYet('apply', 'an unhandled command kind');
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
      let writes = 0;

      const tx: GestureTx = {
        apply: (command) => {
          const outcome = applyCommand(command);
          if (!outcome.ok) return { ok: false, reason: outcome.reason };
          writes += outcome.writes;
          return { ok: true };
        },
        peek: (id) => shapes.get(id),
        // Untested, so unimplemented. An earlier draft tracked an `aborted` flag and lint
        // objected that both branches reading it were constant — which was a fair signal
        // rather than noise: nothing exercises the abort path, so the flag was decoration
        // and the honest answer is to say so until a test asks for Escape-cancels-a-drag.
        abort: () => notYet('gesture().abort', 'the Escape-cancels-a-gesture test'),
      };

      const value = body(tx);
      return { value, committed: writes > 0, opCount: writes };
    },

    subscribe: (): Unsubscribe => notYet('subscribe', 'the first dirty-notification test'),

    drainFaults: (): readonly SceneFault[] => notYet('drainFaults', 'the first resolver test'),

    digest: (): SceneDigest => notYet('digest', 'the Phase 5 convergence probe'),

    stalled: () => notYet('stalled', 'the Phase 6 relay tests'),
  };
};
