import type { Command, CommitStamp } from './commands/command.ts';
import type { Shape, ShapeId } from './schema/shape.ts';
import type { SceneStore } from './scene/store.ts';
import { COMMAND_TOUCHES, checkPatch, reduce } from './commands/apply.ts';
import { COORD_LIMIT } from './schema/bounds.ts';
import { compareDrawOrder } from './scene/order.ts';
import { encodeShape } from './schema/encode.ts';
import { resolveShape } from './schema/migrate.ts';

/**
 * The assertions the property suite runs.
 *
 * Every one is a property of *any* valid scene, checked after *every* command rather than at
 * the end of a run. That matters more than it sounds: a run that ends in a valid state having
 * passed through an invalid one is a bug the suite would otherwise miss entirely, and
 * intermediate states are where a gesture actually lives.
 *
 * Nothing here throws. Violations are returned so the suite can report *which* invariant
 * fired on which seed, which is the difference between a bug report and "the tests are red".
 *
 * These are deliberately **not** a reference model. A second implementation of the store
 * compared against the first is Phase 5's differential test, and it answers a different
 * question — "do the two agree?" rather than "is this scene coherent at all?". Invariants
 * catch a bug that both implementations share; a differential test does not.
 */

export type InvariantName =
  /** No id appears twice in draw order. */
  | 'unique-ids'
  /** Draw order is sorted under the one total order the renderer uses. */
  | 'total-order'
  /** No two shapes carry the same fractional index. */
  | 'distinct-index'
  /** Everything in draw order is still in the store, and is the same object. */
  | 'no-orphans'
  /** Every geometry field is finite and inside the range the bounds arithmetic survives. */
  | 'finite-geometry'
  /** A shape survives the trip out to the document and back unchanged. */
  | 'encode-round-trip'
  /** The patch a command reduces to obeys the architecture's own rules. */
  | 'patch-shape';

export interface Violation {
  readonly invariant: InvariantName;
  /** What was wrong, concretely enough to act on without re-running. */
  readonly detail: string;
  readonly id?: ShapeId;
}

/** Numeric fields of a transform, named so a violation can say which one. */
const COORDS = ['x', 'y', 'w', 'h', 'rot'] as const;

const checkGeometry = (shape: Shape): readonly Violation[] => {
  const bad: Violation[] = [];
  for (const field of COORDS) {
    const value: number = shape.t[field];
    if (!Number.isFinite(value)) {
      bad.push({ invariant: 'finite-geometry', id: shape.id, detail: `t.${field} is ${value}` });
      continue;
    }
    if (Math.abs(value) > COORD_LIMIT) {
      // Not pedantry: every field of `{x: 1e308, w: 1.7e308}` is finite and the box derived
      // from them is Infinity, which `SpatialHash` refuses by throwing.
      bad.push({
        invariant: 'finite-geometry',
        id: shape.id,
        detail: `t.${field} is ${value}, past COORD_LIMIT`,
      });
    }
  }
  return bad;
};

/**
 * Out to the document and back.
 *
 * Catches an asymmetry between the encoder and the resolver — a key one writes and the other
 * cannot read, or a value shape one narrows and the other widens. Quirks are the signal: the
 * resolver only reports one when it had to repair something, and our own encoder's output
 * should never need repairing.
 *
 * Numbers are compared with `===`, so `0` and `-0` compare equal. That is deliberate rather
 * than sloppy: `-0` is legal input, the encoder normalises it on the way out, and a
 * comparison that called that a violation would be asserting the opposite of the design.
 */
const checkRoundTrip = (shape: Shape): readonly Violation[] => {
  const resolved = resolveShape(shape.id, encodeShape(shape));

  if (resolved.quirks.length > 0) {
    const reasons = resolved.quirks.map((quirk) => `${quirk.key}:${quirk.reason}`).join(', ');
    return [
      {
        invariant: 'encode-round-trip',
        id: shape.id,
        detail: `our own encoding needed repair — ${reasons}`,
      },
    ];
  }

  const back = resolved.shape;
  if (back === undefined) {
    return [{ invariant: 'encode-round-trip', id: shape.id, detail: 'did not survive at all' }];
  }

  const bad: Violation[] = [];
  for (const field of COORDS) {
    if (back.t[field] !== shape.t[field]) {
      bad.push({
        invariant: 'encode-round-trip',
        id: shape.id,
        detail: `t.${field} came back as ${back.t[field]}, not ${shape.t[field]}`,
      });
    }
  }
  if (back.idx !== shape.idx) {
    bad.push({ invariant: 'encode-round-trip', id: shape.id, detail: 'idx changed' });
  }
  if (back.kind !== shape.kind) {
    bad.push({ invariant: 'encode-round-trip', id: shape.id, detail: 'kind changed' });
  }
  if (back.author !== shape.author) {
    bad.push({ invariant: 'encode-round-trip', id: shape.id, detail: 'author changed' });
  }
  if (back.style.fill !== shape.style.fill || back.style.stroke !== shape.style.stroke) {
    bad.push({ invariant: 'encode-round-trip', id: shape.id, detail: 'style changed' });
  }
  return bad;
};

/**
 * Every invariant, against one scene.
 *
 * O(n) in the shape count plus one round trip per shape, so it is affordable after every
 * command at the scene sizes the suite generates — which is the whole reason the suite caps
 * scene size rather than letting a plan grow without bound.
 */
export const checkScene = (scene: SceneStore): readonly Violation[] => {
  const order = scene.drawOrder();
  const violations: Violation[] = [];

  const seen = new Set<ShapeId>();
  const indices = new Map<string, ShapeId>();

  for (const [position, shape] of order.entries()) {
    if (seen.has(shape.id)) {
      // The measured `Y.Array` reorder failure: both replicas converge on a doubled entry,
      // which renders as a doubled shape. A `Map`-backed store cannot do this, and the
      // invariant is here because `YjsStore` will run against the same set.
      violations.push({
        invariant: 'unique-ids',
        id: shape.id,
        detail: `appears twice in draw order, second at ${position}`,
      });
    }
    seen.add(shape.id);

    const clash = indices.get(shape.idx);
    if (clash !== undefined) {
      // Two shapes at the same index. Order still resolves, because `compareDrawOrder` breaks
      // the tie on id — but the tie-break is a *last* resort, and reaching it means two
      // clients that asked for different positions were given the same one.
      violations.push({
        invariant: 'distinct-index',
        id: shape.id,
        detail: `shares idx ${shape.idx} with ${clash}`,
      });
    }
    indices.set(shape.idx, shape.id);

    if (!scene.has(shape.id) || scene.get(shape.id) !== shape) {
      violations.push({
        invariant: 'no-orphans',
        id: shape.id,
        detail: 'in draw order but not the shape the store holds',
      });
    }

    const previous = order[position - 1];
    if (previous !== undefined && compareDrawOrder(previous, shape) >= 0) {
      // Draw order comes from an explicit total sort, always. Three byte-identical replicas
      // iterate a `Y.Map` in three different orders, so any order derived from iteration
      // renders differently on every machine.
      violations.push({
        invariant: 'total-order',
        id: shape.id,
        detail: `sorts at or before ${previous.id}, which precedes it`,
      });
    }

    violations.push(...checkGeometry(shape));
    violations.push(...checkRoundTrip(shape));
  }

  return violations;
};

/**
 * The patch a command reduces to, held to the architecture's own rules.
 *
 * A scene invariant cannot see this. A reducer that writes `t` and `style` in one command
 * produces a *perfectly coherent scene* — every id unique, every index distinct, draw order
 * sorted — and costs +120 structs per gesture instead of +2, which shows up as a board that
 * takes eight times longer to load and never as a wrong pixel. So the suite checks the shape
 * of the write as well as the state it produces.
 *
 * A refusal is legal and returns nothing: `reduce` declining a command naming a missing shape
 * is the reducer working, not an invariant breaking.
 */
export const checkCommand = (
  scene: SceneStore,
  command: Command,
  stamp: CommitStamp,
): readonly Violation[] => {
  const reduced = reduce(scene, command, stamp);
  if (!reduced.ok) return [];

  return checkPatch(command.kind, reduced.patch, COMMAND_TOUCHES).map((violation) => ({
    invariant: 'patch-shape' as const,
    detail: violation.violation,
    id: violation.op.id,
  }));
};
