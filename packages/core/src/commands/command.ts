import type { Rect } from '../camera/camera.ts';
import type {
  DocValue,
  FracIdx,
  Shape,
  ShapeDraft,
  ShapeId,
  ShapeKey,
  Style,
  Transform,
} from '../schema/shape.ts';

/**
 * The write API — contract only. Declares no runtime values.
 *
 * **Nothing mutates the scene except by producing one of these.** That is not style; it is
 * what makes the property suite possible. The suite generates `Command` values, drives N
 * replicas with them, and asserts the invariants — so a command vocabulary that leaves a
 * side channel open means the suite is testing something other than the app.
 *
 * The reduction target, {@link PatchOp}, has exactly three members and every one is an
 * **absolute whole-key write**. There is no `unset`, no `merge`, no `increment`, no
 * `splice`, no `move`. That single restriction is load-bearing:
 *
 *  - With only absolute whole-key writes, the projection's semantics simply *are*
 *    last-write-wins-per-key. Nothing in the reducer needs to be commutative, associative
 *    or idempotent, because nothing in the reducer merges.
 *  - It makes a small, yjs-free reference model faithful enough to differential-test the
 *    real binding against — which is the test that catches projection bugs.
 *  - No `unset`, because a concurrent `set` always beats a `delete` on a map key (measured
 *    across every clientID pairing). A key removal is a write that loses; deletion is a
 *    *parent* drop, which wins in both directions.
 */

// ─────────────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────────────

/** At least one element. Makes an empty selection unrepresentable rather than a no-op. */
export type NonEmpty<T> = readonly [T, ...T[]];

export interface CreateCommand {
  readonly kind: 'create';
  readonly draft: ShapeDraft;
}

/**
 * Move, resize or rotate — one entry per shape, each carrying its **whole** geometry.
 *
 * Absolute, not relative. A delta would be a read-modify-write, which is the lost-update
 * pattern this project exists to talk about; two concurrent nudges of +1 would converge on
 * +1 rather than +2, and neither user would see an error.
 *
 * Per-shape atomicity is what this buys, and it is worth being precise about the limit: a
 * group transform gives per-shape atomicity, never per-selection. One shape of a group drag
 * losing its race is a legitimate, explainable outcome; a shape at a position nobody chose
 * is not.
 */
export interface TransformCommand {
  readonly kind: 'transform';
  readonly entries: NonEmpty<{ readonly id: ShapeId; readonly t: Transform }>;
}

export interface RestyleCommand {
  readonly kind: 'restyle';
  /** Whole style per shape — see {@link TransformCommand} on why nothing is relative. */
  readonly entries: NonEmpty<{ readonly id: ShapeId; readonly style: Style }>;
}

/**
 * Reordering, expressed as the resulting index rather than as an intent.
 *
 * "Bring to front" is resolved to a concrete {@link FracIdx} by the caller *before* the
 * command exists, because the alternative — carrying the intent and resolving it in the
 * reducer — makes the reducer read its neighbours, and a reducer that reads the scene is
 * order-dependent. Resolving early keeps the write absolute.
 */
export interface ReorderCommand {
  readonly kind: 'reorder';
  readonly entries: NonEmpty<{ readonly id: ShapeId; readonly idx: FracIdx }>;
}

/**
 * Remove shapes.
 *
 * A parent drop, deliberately — it beats a concurrent child write in both clientID
 * directions, whereas a key-level removal would lose to one. Note the asymmetry this
 * creates and do not paper over it: a peer's concurrent restyle of a shape being deleted is
 * annihilated with no event to surface.
 */
export interface DeleteCommand {
  readonly kind: 'delete';
  readonly ids: NonEmpty<ShapeId>;
}

export type Command =
  | CreateCommand
  | TransformCommand
  | RestyleCommand
  | ReorderCommand
  | DeleteCommand;

export type CommandKind = Command['kind'];

/**
 * Contract for the write-footprint table.
 *
 * Mapped over {@link CommandKind}, so adding a command is a **compile error** until its
 * footprint is declared. The implementation must additionally satisfy the one-hot-key
 * budget: no command may touch more than one `hot` key, or the struct merge is lost for
 * both and a 60-frame drag costs 120 structs instead of 2. A change needing geometry *and*
 * style is two commands, hence two gestures, hence two undo steps.
 */
export type CommandTouches = Readonly<Record<CommandKind, readonly ShapeKey[]>>;

/** Contract for extracting a command's targets, for dirty tracking and permission checks. */
export type CommandTargets = (cmd: Command) => readonly ShapeId[];

// ─────────────────────────────────────────────────────────────────────────────────────
// Reduction
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The three document operations. Absolute whole-key writes, nothing else.
 *
 * - `put` — write a whole shape container at a root key. A create is genuinely one
 *   whole-map write, not N per-key writes; two clients creating the same id therefore
 *   produce one shape by clientID rather than a chimera.
 * - `set` — write one whole key of one shape.
 * - `drop` — remove a shape container from the root map.
 */
export type PatchOp =
  | { readonly op: 'put'; readonly id: ShapeId; readonly values: Readonly<Partial<Record<ShapeKey, DocValue>>> }
  | { readonly op: 'set'; readonly id: ShapeId; readonly key: ShapeKey; readonly value: DocValue }
  | { readonly op: 'drop'; readonly id: ShapeId };

/** An ordered batch. One patch is one transaction, therefore one wire message, therefore one undo step. */
export type Patch = readonly PatchOp[];

/**
 * The read surface a reducer is given.
 *
 * Narrow on purpose: a reducer that can see the whole scene will eventually iterate it, and
 * that is how an O(n) cost lands on a per-gesture path. It also cannot see draw order,
 * because resolving order is the caller's job (see {@link ReorderCommand}).
 */
export interface ScenePeek {
  readonly get: (id: ShapeId) => Shape | undefined;
  readonly has: (id: ShapeId) => boolean;
}

/** Why a command was refused. Refusal is a normal outcome, not an exception. */
export type RejectReason =
  | 'unknown-shape'
  | 'not-finite'
  | 'out-of-range'
  | 'empty-selection'
  | 'too-many-targets'
  | 'immutable-field';

/**
 * A command either produces a patch or is refused, with a reason.
 *
 * An empty patch is a legitimate success: a drag that returns to its starting position must
 * cost nothing. Suppressing that no-op is not an optimisation — without it every
 * round-trip drag leaves a struct and a dead Ctrl+Z on the stack.
 */
export type ReduceResult =
  | { readonly ok: true; readonly patch: Patch }
  | { readonly ok: false; readonly reason: RejectReason; readonly id?: ShapeId };

/** Stamped by the store, never by a caller — this is where forged attribution is prevented. */
export interface CommitStamp {
  readonly author: string;
  /** Epoch millis. A `Date` must never enter the document; see the schema's guarantees. */
  readonly at: number;
}

/**
 * Contract for the reducer: pure, total, and **order-dependent**.
 *
 * The order-dependence is not a defect to be fixed, it is a fact to be stated. `reduce`
 * reads the scene, so replaying the same multiset of commands in a different order yields a
 * different scene. Convergence therefore comes from the CRDT's per-key last-write-wins and
 * from nothing else. Two consequences the whole design accepts:
 *
 *  - The command log is an **audit, fuzz and single-player-replay** artefact. It is not a
 *    synchronisation mechanism and not a recovery mechanism. A CRDT is not an event log.
 *  - **Intent is not preserved; only per-key effect is.** A group resize computed against
 *    bounds a peer changed a frame earlier converges on geometry nobody asked for. Both
 *    replicas agree and both are wrong. Only an intent-preserving transform would fix it,
 *    and Yjs has none. This is the honest limit of the design.
 */
export type Reduce = (scene: ScenePeek, cmd: Command, stamp: CommitStamp) => ReduceResult;

// ─────────────────────────────────────────────────────────────────────────────────────
// Inversion
// ─────────────────────────────────────────────────────────────────────────────────────

/** What an inverse loses when it is applied in the presence of peers. */
export type LossReason =
  | 'peer-field-write-annihilated'
  | 'peer-restyle-lost-on-resurrect'
  | 'stale-geometry-restored';

/**
 * The inverse of a command — typed so a caller cannot pretend it is sound.
 *
 * This is where a command-shaped design most wants to overreach. Only `create` inverts
 * exactly: its inverse is a parent drop, which beats every concurrent child write in both
 * directions. Everything else is `lossy`, with a measured example: A deletes a shape while
 * B concurrently restyles it; the parent delete wins; A undoes; the shape returns with its
 * pre-delete style and B's restyle is gone from every replica.
 *
 * So inverses are for **single-player** (`MemoryStore`), where there are no peers for a
 * lossy inverse to lose anything to. Multiplayer undo delegates to `Y.UndoManager`, which
 * reverses real struct ranges rather than guessing at intent.
 */
export type Inverse =
  | { readonly kind: 'exact'; readonly cmd: Command }
  | { readonly kind: 'lossy'; readonly cmd: Command; readonly loses: LossReason }
  | { readonly kind: 'none' };

export type Invert = (scene: ScenePeek, cmd: Command) => Inverse;

// ─────────────────────────────────────────────────────────────────────────────────────
// Helpers the interaction layer needs
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Seedable randomness, injected.
 *
 * `Math.random()` is banned in this package by lint, and the reason is this type: the
 * fractional index needs jitter, and a failing property-suite seed has to reproduce
 * exactly. Entropy is an argument, never an ambient capability.
 */
export type Rng = () => number;

/** Contract for generating an index strictly between two neighbours, jittered. */
export type IdxBetween = (before: FracIdx | undefined, after: FracIdx | undefined, rng: Rng) => FracIdx;

/** Bounds of a selection, for group transforms and marquee feedback. */
export type SelectionBounds = (scene: ScenePeek, ids: readonly ShapeId[]) => Rect | undefined;

/**
 * Contract for the plan checker used by the property suite.
 *
 * Separate from `reduce` on purpose: `reduce` decides whether a command is *valid*, this
 * decides whether a produced patch obeys the architecture's own rules — one hot key per
 * command, no key removal, no relative op. It is how a future contributor who adds a
 * command finds out at test time rather than at incident time.
 *
 * **Takes the kind.** Amended 2026-09-03: the first draft was `(patch, touches)`, which
 * cannot use its own second argument. A patch does not carry the kind that produced it, so
 * there is no row of {@link CommandTouches} to compare it against — and any "writes an
 * undeclared key" rule is vacuous anyway, because `create` declares every key. With the kind
 * in hand the table becomes load-bearing: a command whose implementation drifts from its
 * declared footprint is a violation, which is the drift the table exists to catch.
 */
export type CheckPatch = (
  kind: CommandKind,
  patch: Patch,
  touches: CommandTouches,
) => readonly { readonly violation: string; readonly op: PatchOp }[];

// ─────────────────────────────────────────────────────────────────────────────────────
// Type-level assertions
// ─────────────────────────────────────────────────────────────────────────────────────

type Assert<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;

/** The write-API claims, asserted. Each is a compile error if it stops holding. */
export type CommandGuarantees = [
  // The patch vocabulary stays absolute. A relative or removal op would break the
  // reference model's fidelity, and with it the differential test.
  Assert<Not<'unset' extends PatchOp['op'] ? true : false>>,
  Assert<Not<'merge' extends PatchOp['op'] ? true : false>>,
  Assert<Not<'incr' extends PatchOp['op'] ? true : false>>,
  Assert<Not<'move' extends PatchOp['op'] ? true : false>>,
  Assert<Not<'splice' extends PatchOp['op'] ? true : false>>,
  // A selection command cannot be constructed empty.
  Assert<Not<readonly [] extends TransformCommand['entries'] ? true : false>>,
  Assert<Not<readonly [] extends DeleteCommand['ids'] ? true : false>>,
];
