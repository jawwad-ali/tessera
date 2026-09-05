import type { Command, GestureResult, SceneStore, ShapeId } from '@tessera/core';
import { invertCommand } from '@tessera/core';

/**
 * Single-player undo and redo, over `MemoryStore`.
 *
 * The stack lives here, in the interaction layer, and not in the store. `SceneStore` deliberately
 * declares no undo member: the multiplayer store defers to `Y.UndoManager`, which reverses real
 * struct ranges, and a same-named member with different semantics across the two stores is the
 * footgun invariant 8 exists to stop.
 *
 * **One committed gesture is one step.** A gesture the store suppressed — a drag that ended where
 * it began — is not a step at all, so Ctrl+Z after it undoes the gesture *before* it. That is
 * `4.C5`, and it falls out of reading `committed` rather than counting calls.
 */

interface Entry {
  /** Replayed to undo. Inverses of the gesture's commands, in reverse order. */
  readonly undo: readonly Command[];
  /** Replayed to redo. The gesture's original commands. */
  readonly redo: readonly Command[];
}

export interface History {
  /**
   * Run one gesture. Records an undo step only if the store committed something.
   *
   * Inverses are computed **before** the commands apply, against the scene as it stands — a
   * move's inverse is the geometry the shape has now, which is gone afterwards.
   */
  readonly perform: (commands: readonly Command[]) => GestureResult<void>;
  readonly undo: () => boolean;
  readonly redo: () => boolean;
  readonly depth: () => { readonly undo: number; readonly redo: number };
}

/**
 * A multi-shape delete has no single-command inverse — it is several creates — so it is split
 * per id before inverting. Everything else inverts as itself.
 */
const perShape = (command: Command): readonly Command[] => {
  if (command.kind !== 'delete') return [command];
  return command.ids.map((id: ShapeId) => ({ kind: 'delete', ids: [id] }));
};

export const createHistory = (store: SceneStore): History => {
  const past: Entry[] = [];
  const future: Entry[] = [];

  const run = (commands: readonly Command[]): GestureResult<void> =>
    store.gesture((tx) => {
      for (const command of commands) tx.apply(command);
    });

  return {
    perform: (commands) => {
      // Inverses first. The scene the inverse needs is the one before the gesture, and there
      // is no reading it afterwards. A command whose inverse is `none` — it named a shape that
      // is not there — contributes nothing, and the store will refuse it anyway.
      const undo: Command[] = [];
      for (const command of commands.flatMap(perShape)) {
        const inverse = invertCommand(store, command);
        if (inverse.kind !== 'none') undo.unshift(inverse.cmd);
      }

      const result = run(commands);
      if (result.committed) {
        past.push({ undo, redo: commands });
        // A new gesture after an undo leaves the redo branch behind. Keeping it would let
        // redo replay a move onto a shape that no longer has the geometry it assumed.
        future.length = 0;
      }
      return result;
    },

    undo: () => {
      const entry = past.pop();
      if (entry === undefined) return false;
      run(entry.undo);
      future.push(entry);
      return true;
    },

    redo: () => {
      const entry = future.pop();
      if (entry === undefined) return false;
      run(entry.redo);
      past.push(entry);
      return true;
    },

    depth: () => ({ undo: past.length, redo: future.length }),
  };
};
