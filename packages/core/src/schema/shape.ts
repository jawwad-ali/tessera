/**
 * The shape schema — contract only. This file declares no runtime values and erases to
 * nothing; the implementation phase writes functions that satisfy the exported function
 * types.
 *
 * Everything here is shaped by measurement rather than taste. The load-bearing findings,
 * all reproduced against yjs 13.6.32:
 *
 *  - `Item.mergeWith` needs adjacency in the *writing client's* struct list, so a repeated
 *    write merges only if it is the only thing that client writes that frame. Hence exactly
 *    one **hot** key (§ {@link KeyClass}) and a frozen key set.
 *  - A concurrent `set` on a map key **always** beats a `delete` of that key — verified
 *    across clientID pairings from 1 to 4,294,967,295. But a *parent* delete beats a
 *    concurrent child write, in both directions. Two opposite rules at two levels, which is
 *    why {@link ShapeKey} has no removal operation at all and deletion is a parent drop.
 *  - A `Y.Map` accepts `NaN`, `Infinity`, `-0`, a 10 MB string, and `undefined` as a
 *    *present key*, silently, propagating all of it to every replica. `Date` is worse: it
 *    converges at the byte level and diverges at the content level, because the writer holds
 *    a real `Date` and every peer holds `{}`. Hence {@link DocValue} and the type-level
 *    assertions at the end of this file.
 *  - A shape create is a **whole-map write at the root key**, not N per-key writes. So two
 *    clients creating the same id do not produce a chimera; one container wins by clientID
 *    and writes into the loser are permanently invisible.
 */

// ─────────────────────────────────────────────────────────────────────────────────────
// Branded primitives
// ─────────────────────────────────────────────────────────────────────────────────────

// `declare const` erases completely, which `erasableSyntaxOnly` requires. Note the trap:
// a `unique symbol` declared this way is safe in a TYPE position and throws
// `ReferenceError` if ever used as a computed key in a runtime object literal.
declare const ShapeIdBrand: unique symbol;
declare const FracIdxBrand: unique symbol;
declare const FiniteBrand: unique symbol;

/**
 * A shape's identity: a nanoid minted by the app layer.
 *
 * Deliberately unrelated to any Yjs `Item` id. Those address *ranges* of
 * `(client, clock)` and change when structs split and merge, so they can never identify a
 * shape. This is the key in the root map.
 */
export type ShapeId = string & { readonly [ShapeIdBrand]: 'ShapeId' };

/**
 * A jittered fractional index: an opaque, bytewise-comparable ordering string.
 *
 * Draw order is a *value*, never a position, because Yjs has no move operation in v13 or in
 * the v14 RC — and a concurrent reorder of a `Y.Array` does not merely risk duplication, it
 * deterministically duplicates (measured: both replicas converge on `["b","c","a","a"]`,
 * which renders as a doubled shape). The jitter matters too: without it two clients
 * inserting between the same neighbours generate the *identical* key.
 */
export type FracIdx = string & { readonly [FracIdxBrand]: 'FracIdx' };

/**
 * A number proven finite at the boundary it entered through.
 *
 * The document layer cannot be trusted to hold one: NaN and Infinity survive a round trip
 * as genuine NaN and Infinity. Carrying the proof in the type means the renderer and the
 * spatial index consume numbers that have already been checked, rather than each
 * re-checking or — the actual failure — neither checking.
 */
export type Finite = number & { readonly [FiniteBrand]: 'Finite' };

// ─────────────────────────────────────────────────────────────────────────────────────
// What may cross into the document
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The complete set of values that survive a Yjs round trip unchanged.
 *
 * Structural by construction, so a class instance cannot satisfy it: `Date`, `Map`, `Set`
 * and every other object with a prototype are excluded because the index signature demands
 * every property be a `DocValue`. That turns the measured `Date` hazard —
 * type-identical in TypeScript, `{}` on every peer, no error anywhere — into a compile
 * error at the one place it can be introduced.
 */
export type DocValue =
  | string
  | number
  | boolean
  | null
  | readonly DocValue[]
  | { readonly [key: string]: DocValue };

// ─────────────────────────────────────────────────────────────────────────────────────
// Shape fields
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The whole of a shape's geometry, in **one** map key.
 *
 * Not five keys, and not for byte reasons — V2 encoding makes the two layouts equivalent
 * on size. It is one key because struct count drives cold load (7–12× measured), and
 * because it makes a transform atomic: a concurrent drag against a concurrent resize
 * converges on one client's whole geometry rather than a mixture of both.
 */
export interface Transform {
  readonly x: Finite;
  readonly y: Finite;
  readonly w: Finite;
  readonly h: Finite;
  /** Radians. `-0` is ordinary arithmetic here and must be accepted, then normalised on encode. */
  readonly rot: Finite;
}

/**
 * Appearance, also one key.
 *
 * The cost is explicit and a user will notice it: concurrent changes to fill and to stroke
 * do not merge, so one of them is lost entirely. Per-property keys would fix that and would
 * reintroduce the interleave penalty on every restyle. The cheaper failure was chosen
 * deliberately; if that trade is ever revisited, revisit it with a measurement.
 */
export interface Style {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: Finite;
  readonly opacity: Finite;
}

/**
 * A finished freehand stroke, packed into a single value.
 *
 * Never a `Y.Array` of points: a stroke arrives as thousands of samples, and one item per
 * point is how a board becomes megabytes and how one gesture becomes thousands of wire
 * messages. Points are quantised to a fixed grid and delta-encoded, and the whole stroke is
 * written once on pointerup — immutable thereafter, so it never fragments the store.
 */
export interface PackedInk {
  /** Quantisation step in board units. Recorded so a future change stays decodable. */
  readonly q: Finite;
  /** Base64 of int16 deltas. Opaque to everything above the schema. */
  readonly d: string;
  /** Point count, so a consumer can size a buffer without decoding. */
  readonly n: number;
}

// ─────────────────────────────────────────────────────────────────────────────────────
// The frozen key set
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Every key a shape's map may carry, ever.
 *
 * Frozen on purpose. Values evolve freely — `Transform` may gain a field, a colour may
 * change representation — because a value-shape change on one key is decided by clientID
 * and the resolver simply accepts both forms. Splitting a field across a *new* key is the
 * expensive move, because the old key can then never be removed (a concurrent `set` beats a
 * `delete`) and must win forever, since the only clients still writing it are the ones that
 * do not know the new key. See {@link LegacyShapeKey}.
 */
export type ShapeKey = 'id' | 'v' | 'kind' | 't' | 'idx' | 'author' | 'style' | 'ink';

/**
 * How a key behaves under repeated writes.
 *
 * - `hot` — written many times per gesture. **At most one hot key per command**, or the
 *   merge is lost for both and the drag costs 120 structs instead of 2.
 * - `cold` — written occasionally, by a deliberate user action.
 * - `birth` — written once, at creation, and never again. Immutable keys never fragment.
 */
export type KeyClass = 'hot' | 'cold' | 'birth';

/**
 * Contract for the classification table.
 *
 * A mapped type over {@link ShapeKey}, so adding a key is a **compile error** until its
 * write behaviour is declared. That is the whole enforcement mechanism: the table cannot
 * drift from the key set, because it is generated from it.
 */
export type KeyClassTable = Readonly<Record<ShapeKey, KeyClass>>;

/**
 * Keys that exist only to be read, never written by a current client.
 *
 * Empty today. It gains a member the first time a field is split across keys, and every
 * member is permanent: legacy-wins-if-present means the legacy domain is **contagious** —
 * a modern client editing a shape that still carries a legacy key must keep writing that
 * key, in the legacy representation, or it loses the race against the old client whose work
 * is the work actually at risk. The exit is an epoch bump, not a migration. So the real job
 * of the frozen key set is to ensure this type stays empty.
 */
export type LegacyShapeKey = never;

// ─────────────────────────────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────────────────────────────

export type ShapeKind = 'rect' | 'pen';

/** Bumped only when the *set* of keys changes, never when a value representation changes. */
export type SchemaVersion = 1;

export interface ShapeBase {
  readonly id: ShapeId;
  /**
   * Schema version of the last **writer**, not of the value.
   *
   * This distinction is load-bearing and easy to get backwards: a v1 client's drag lands on
   * the `t` key of a shape stamped `v: 2` and wins the clientID race, so the value is now
   * v1-shaped on a v2-stamped shape. The resolver must therefore sniff each *value* and
   * must never branch on `v`. `v` is a diagnostic, and a signal for when an epoch bump is
   * safe.
   */
  readonly v: SchemaVersion;
  readonly kind: ShapeKind;
  readonly t: Transform;
  readonly idx: FracIdx;
  readonly style: Style;
  /**
   * Who made it — a user id, written by the **server**.
   *
   * Never derived from `doc.clientID`: that is `random.uint32()` per `Y.Doc` instance, so
   * it is a session nonce rather than an identity, it is forgeable with one assignment, and
   * 32 bits collide around 77k lifetime clients. A client-supplied author field is an
   * impersonation bug with extra steps.
   */
  readonly author: string;
}

export interface RectShape extends ShapeBase {
  readonly kind: 'rect';
}

export interface PenShape extends ShapeBase {
  readonly kind: 'pen';
  /** Immutable once committed. A pen shape is resized by writing `t`, never by rewriting `ink`. */
  readonly ink: PackedInk;
}

export type Shape = RectShape | PenShape;

/**
 * What a caller may supply when creating a shape.
 *
 * `author` and `v` are omitted, not optional: the store stamps both, so forged attribution
 * is unrepresentable rather than merely discouraged.
 */
export type ShapeDraft = Omit<RectShape, 'author' | 'v'> | Omit<PenShape, 'author' | 'v'>;

// ─────────────────────────────────────────────────────────────────────────────────────
// Reading untrusted document content
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A shape as it actually arrived: a bag of unknown values.
 *
 * This is the honest type for document content, and the reason validation belongs at the
 * **observer** boundary rather than the write boundary. Our own writes are already
 * well-typed; the values that need checking are the ones a peer sent, and a hostile peer
 * skips our write path entirely.
 */
export type RawShape = Readonly<Partial<Record<ShapeKey, unknown>>>;

/**
 * Something the document contained that the schema could not accept.
 *
 * Surfaced rather than thrown, because a resolver that throws turns one bad shape from one
 * bad peer into a blank board for everyone. Every quirk is counted and reported: the counts
 * are how you learn a peer is broken, and how you learn when a legacy key has finally
 * fallen out of use.
 */
export interface Quirk {
  readonly id: ShapeId;
  readonly key: ShapeKey;
  readonly reason:
    | 'missing'
    | 'wrong-type'
    | 'not-finite'
    | 'out-of-range'
    | 'too-long'
    | 'unknown-kind'
    | 'legacy-form';
}

/**
 * The result of resolving one raw shape.
 *
 * `shape` is `undefined` only when the record cannot be rendered at all — no usable kind or
 * geometry. Anything repairable is repaired, with a quirk recorded, because a shape that
 * renders slightly wrong is better than a hole in the board.
 */
export interface Resolved {
  readonly shape: Shape | undefined;
  readonly quirks: readonly Quirk[];
}

/**
 * Contract for the resolver: **total**, and never throws.
 *
 * Totality is the requirement. This function is the only thing standing between a
 * `Y.Map` — which silently accepts NaN, `undefined` as a present key, and a 10 MB string —
 * and the renderer.
 */
export type ResolveShape = (id: ShapeId, raw: RawShape) => Resolved;

/** Contract for encoding a shape for the document. Returns the exact per-key values to write. */
export type EncodeShape = (shape: Shape) => Readonly<Partial<Record<ShapeKey, DocValue>>>;

/** Axis-aligned bounds of a shape in board units, for the spatial index and culling. */
export type ShapeBounds = (shape: Shape) => {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/**
 * Contract for the draw-order comparator.
 *
 * Total order, with `id` as the tie-break — jitter makes an identical `idx` unlikely, not
 * impossible, and an unstable comparator makes two replicas render the same converged
 * document in different orders. Nothing may derive draw order from map iteration: three
 * byte-identical replicas iterate a `Y.Map` in three different orders (measured).
 */
export type CompareDrawOrder = (a: Shape, b: Shape) => number;

// ─────────────────────────────────────────────────────────────────────────────────────
// Type-level assertions
// ─────────────────────────────────────────────────────────────────────────────────────

/** Fails to compile unless `T` is exactly `true`. */
type Assert<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;

/**
 * The hazards this schema claims to make unrepresentable, asserted rather than described.
 *
 * Each line is a compile error if the claim stops holding — which is the difference between
 * a comment and a guarantee. They erase to nothing.
 */
export type SchemaGuarantees = [
  // A Date cannot enter the document. This is the measured hazard that is invisible at
  // runtime: byte-convergent, content-divergent, no error anywhere.
  Assert<Not<Date extends DocValue ? true : false>>,
  Assert<Not<Map<string, string> extends DocValue ? true : false>>,
  Assert<Not<Set<string> extends DocValue ? true : false>>,
  // `undefined` arrives as a *present key* holding undefined, so it must not be a DocValue.
  Assert<Not<undefined extends DocValue ? true : false>>,
  // A shape draft cannot carry attribution: the server stamps it.
  Assert<Not<'author' extends keyof ShapeDraft ? true : false>>,
  Assert<Not<'v' extends keyof ShapeDraft ? true : false>>,
  // Geometry is one key. If `Transform` is ever flattened onto the shape, this breaks.
  Assert<'t' extends ShapeKey ? true : false>,
  Assert<Not<'x' extends ShapeKey ? true : false>>,
];
