import type {
  CheckPatch,
  Command,
  CommandTouches,
  CommitStamp,
  Invert,
  NonEmpty,
  PatchOp,
  Reduce,
  ScenePeek,
  SelectionBounds,
} from './command.ts';
import type { Shape, ShapeDraft, ShapeId, ShapeKey } from '../schema/shape.ts';
import { HOT_KEYS } from '../schema/keys.ts';
import { transformBounds } from '../schema/bounds.ts';
import { SCHEMA_VERSION } from '../schema/validate.ts';
import { encodeShape, encodeStyleValue, encodeTransformValue } from '../schema/encode.ts';

/**
 * The reducer, its declared write footprints, and the checker that holds it to them.
 *
 * Every mutation in the system is one of five commands reduced to a patch of absolute
 * whole-key writes. Nothing merges here and nothing is relative, which is what makes the
 * projection's semantics simply *be* last-write-wins-per-key — and what makes a small
 * yjs-free reference model faithful enough to differential-test the real binding against.
 */

/**
 * What each command is allowed to write.
 *
 * A mapped type over {@link CommandKind}, so adding a command is a compile error until its
 * footprint is declared. `delete` touches no keys at all: it is a parent drop, which beats a
 * concurrent child write in both clientID directions, where a key-level removal would lose
 * to one of them and bring the shape back.
 */
export const COMMAND_TOUCHES: CommandTouches = {
  create: ['id', 'v', 'kind', 't', 'idx', 'author', 'style', 'ink'],
  transform: ['t'],
  restyle: ['style'],
  reorder: ['idx'],
  delete: [],
};

/**
 * The first shape a command names that is not in the scene.
 *
 * Shared rather than reimplemented, because two stores satisfy `SceneStore` and a command
 * that one refuses and the other accepts is a divergence no digest would catch — the
 * replicas would simply hold different scenes and both be internally consistent.
 *
 * Takes a {@link ScenePeek}, so a caller mid-gesture can pass a staged-aware view and have a
 * shape created earlier in the same gesture count as present.
 */
export const missingTarget = (scene: ScenePeek, cmd: Command): ShapeId | undefined => {
  switch (cmd.kind) {
    case 'create':
      return undefined;
    case 'delete':
      return cmd.ids.find((id) => !scene.has(id));
    case 'transform':
    case 'restyle':
    case 'reorder':
      return cmd.entries.find((entry) => !scene.has(entry.id))?.id;
  }
};

/**
 * Apply the commit stamp to a draft.
 *
 * The only place `author` and `v` are added. `ShapeDraft` omits both so a forged attribution
 * is unrepresentable rather than merely rejected, and that guarantee is only as good as
 * there being one function that can mint them.
 */
export const stampShape = (draft: ShapeDraft, stamp: CommitStamp): Shape => ({
  ...draft,
  author: stamp.author,
  v: SCHEMA_VERSION,
});

/**
 * Reduce a command to a patch, or refuse it with a reason.
 *
 * Order-dependent, and that is a fact rather than a defect: it reads the scene, so replaying
 * the same commands in a different order yields a different scene. Convergence comes from
 * the CRDT's per-key last-write-wins and from nothing else — the command log is an audit and
 * replay artefact, never a synchronisation mechanism.
 *
 * A command that names any missing shape is refused **whole**. One patch is one transaction,
 * so half-applying a group command would tear a selection apart on screen with nothing
 * raised to explain it.
 */
export const reduce: Reduce = (scene, cmd, stamp) => {
  switch (cmd.kind) {
    case 'create': {
      const shape = stampShape(cmd.draft, stamp);
      return { ok: true, patch: [{ op: 'put', id: shape.id, values: encodeShape(shape) }] };
    }

    case 'transform': {
      const missing = missingTarget(scene, cmd);
      if (missing !== undefined) return { ok: false, reason: 'unknown-shape', id: missing };
      return {
        ok: true,
        patch: cmd.entries.map((entry) => ({
          op: 'set',
          id: entry.id,
          key: 't',
          value: encodeTransformValue(entry.t),
        })),
      };
    }

    case 'restyle': {
      const missing = missingTarget(scene, cmd);
      if (missing !== undefined) return { ok: false, reason: 'unknown-shape', id: missing };
      return {
        ok: true,
        patch: cmd.entries.map((entry) => ({
          op: 'set',
          id: entry.id,
          key: 'style',
          value: encodeStyleValue(entry.style),
        })),
      };
    }

    case 'reorder': {
      const missing = missingTarget(scene, cmd);
      if (missing !== undefined) return { ok: false, reason: 'unknown-shape', id: missing };
      return {
        ok: true,
        patch: cmd.entries.map((entry) => ({
          op: 'set',
          id: entry.id,
          key: 'idx',
          value: entry.idx,
        })),
      };
    }

    case 'delete': {
      const missing = missingTarget(scene, cmd);
      if (missing !== undefined) return { ok: false, reason: 'unknown-shape', id: missing };
      return { ok: true, patch: cmd.ids.map((id) => ({ op: 'drop', id })) };
    }
  }
};

/** The three ops that are absolute whole-key writes. Anything else is not a patch. */
const ABSOLUTE_OPS: readonly string[] = ['put', 'set', 'drop'];

/**
 * Hold a patch to the architecture's own rules.
 *
 * Not a second validator: `reduce` decides whether a *command* is legal, this decides
 * whether the *patch* is one at all. It runs on generated input in the property suite and on
 * hand-written input in tests, which is where patches that the type system never saw arrive
 * from.
 */
export const checkPatch: CheckPatch = (kind, patch, touches) => {
  const violations: { readonly violation: string; readonly op: PatchOp }[] = [];
  const declared = touches[kind];
  let hotKey: ShapeKey | undefined;

  for (const op of patch) {
    if (!ABSOLUTE_OPS.includes(op.op)) {
      // Reachable only by a cast, which is exactly how a generated or hand-written patch
      // arrives. A relative op is the lost-update pattern: two concurrent nudges of +1
      // converge on +1, and neither user sees an error.
      violations.push({ violation: `'${op.op}' is not an absolute whole-key write`, op });
      continue;
    }

    if (op.op === 'drop') continue;

    if (op.op === 'put') {
      for (const key of Object.keys(op.values)) {
        if (!declared.includes(key as ShapeKey)) {
          violations.push({ violation: `${kind} writes '${key}' outside its footprint`, op });
        }
      }
      continue;
    }

    if (!declared.includes(op.key)) {
      violations.push({ violation: `${kind} writes '${op.key}' outside its footprint`, op });
      continue;
    }

    // Widened deliberately. The declared type is `DocValue`, which excludes `undefined`, and
    // that declaration is exactly the claim this checker exists to verify rather than trust:
    // every patch it sees arrived from a property generator or a hand-written test, both
    // through a cast. Comparing against the type would make the check unreachable, which is
    // what the linter correctly pointed out before this line was widened.
    const written: unknown = op.value;
    if (written === undefined) {
      // A concurrent `set` always beats a `delete` on a map key — `typeMapDelete` creates no
      // struct — so a key removal is a write that loses. Deletion is a parent drop.
      violations.push({ violation: `removal-shaped write to '${op.key}'`, op });
      continue;
    }

    if (!HOT_KEYS.includes(op.key)) continue;

    if (hotKey === undefined) {
      hotKey = op.key;
      continue;
    }
    if (hotKey !== op.key) {
      // Measured: `t` alone over a gesture costs +2 structs, `t` and `style` together cost
      // +120, because a repeated write merges only if it is the only thing that client wrote
      // that frame. A change needing both is two commands, hence two undo steps.
      violations.push({
        violation: `${kind} writes two hot keys, '${hotKey}' and '${op.key}'`,
        op,
      });
    }
  }

  return violations;
};

/**
 * Map a non-empty list to a non-empty list, or to nothing if any element maps to nothing.
 *
 * The all-or-nothing is the point: an inverse that restores two of three shapes is an undo
 * step that half-happens, which is worse than one that reports it cannot happen.
 */
const mapAll = <A, B>(items: NonEmpty<A>, f: (item: A) => B | undefined): NonEmpty<B> | undefined => {
  const out: B[] = [];
  for (const item of items) {
    const mapped = f(item);
    if (mapped === undefined) return undefined;
    out.push(mapped);
  }
  const [first, ...rest] = out;
  return first === undefined ? undefined : [first, ...rest];
};

/** A shape as a draft again: everything the store did not stamp. */
const draftOf = (shape: Shape): ShapeDraft =>
  shape.kind === 'pen'
    ? { id: shape.id, kind: 'pen', t: shape.t, idx: shape.idx, style: shape.style, ink: shape.ink }
    : { id: shape.id, kind: 'rect', t: shape.t, idx: shape.idx, style: shape.style };

/**
 * The inverse of a command, read from the scene BEFORE the command is applied.
 *
 * Only `create` inverts exactly — its inverse is a parent drop, which beats every concurrent
 * child write in both clientID directions. Everything else is `lossy` and says how: restoring
 * geometry a peer has since changed, or resurrecting a shape without the restyle a peer applied
 * to it while it was being deleted. Single-player has no peers to lose anything to, which is
 * why `MemoryStore`'s history uses these and the multiplayer store defers to `Y.UndoManager`.
 *
 * A multi-shape `delete` has no single-command inverse — its inverse is several creates — so
 * it returns `none` and the history layer splits a deletion per id before asking. Stated here
 * rather than worked around silently, because the alternative was widening `Inverse` to carry
 * a list and pretending one undo step is one command when it is not.
 */
export const invert: Invert = (scene, cmd) => {
  switch (cmd.kind) {
    case 'create':
      return { kind: 'exact', cmd: { kind: 'delete', ids: [cmd.draft.id] } };

    case 'transform': {
      const entries = mapAll(cmd.entries, (entry) => {
        const shape = scene.get(entry.id);
        return shape === undefined ? undefined : { id: entry.id, t: shape.t };
      });
      if (entries === undefined) return { kind: 'none' };
      return { kind: 'lossy', loses: 'stale-geometry-restored', cmd: { kind: 'transform', entries } };
    }

    case 'restyle': {
      const entries = mapAll(cmd.entries, (entry) => {
        const shape = scene.get(entry.id);
        return shape === undefined ? undefined : { id: entry.id, style: shape.style };
      });
      if (entries === undefined) return { kind: 'none' };
      return { kind: 'lossy', loses: 'peer-field-write-annihilated', cmd: { kind: 'restyle', entries } };
    }

    case 'reorder': {
      const entries = mapAll(cmd.entries, (entry) => {
        const shape = scene.get(entry.id);
        return shape === undefined ? undefined : { id: entry.id, idx: shape.idx };
      });
      if (entries === undefined) return { kind: 'none' };
      return { kind: 'lossy', loses: 'peer-field-write-annihilated', cmd: { kind: 'reorder', entries } };
    }

    case 'delete': {
      const [only, ...more] = cmd.ids;
      if (more.length > 0) return { kind: 'none' };
      const shape = scene.get(only);
      if (shape === undefined) return { kind: 'none' };
      return {
        kind: 'lossy',
        loses: 'peer-restyle-lost-on-resurrect',
        cmd: { kind: 'create', draft: draftOf(shape) },
      };
    }
  }
};

/**
 * The box around a selection, rotation included, for handles and marquee feedback.
 *
 * Ids that are no longer in the scene are skipped rather than failing the whole box: a
 * selection outliving one of its shapes is ordinary after an undo, and the handles should go
 * around what is still there.
 */
export const selectionBounds: SelectionBounds = (scene, ids) => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const id of ids) {
    const shape = scene.get(id);
    if (shape === undefined) continue;
    const box = transformBounds(shape.t);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }

  if (!Number.isFinite(minX)) return undefined;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};
