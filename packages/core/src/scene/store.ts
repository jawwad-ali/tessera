import type { Rect } from '../camera/camera.ts';
import type { Command, RejectReason } from '../commands/command.ts';
import type { Quirk, Shape, ShapeId, ShapeKey } from '../schema/shape.ts';

/**
 * The seam — contract only. Declares no runtime values.
 *
 * Two implementations satisfy this: `MemoryStore` in this package (single-player, no yjs,
 * and what the property suite drives) and `YjsStore` in `@tessera/crdt`. Nothing above the
 * seam knows which it has, which is how single-player gets built first and how the
 * convergence suite runs with no browser and no CRDT present.
 */

// ─────────────────────────────────────────────────────────────────────────────────────
// Origins
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Where a change came from. Every write carries one; there is no origin-less path.
 *
 * **Implementations must be classes, not object literals.** `Y.UndoManager` matches
 * `trackedOrigins` against the origin's *constructor*, so a class is what lets each gesture
 * carry a unique origin instance — with its own gesture id, for the command log — while
 * still being tracked by a single registry entry. Object literals cannot do both.
 *
 * The classes live in `@tessera/crdt` rather than here, because this package declares no
 * runtime values. This type is the contract they satisfy.
 */
export type OriginKind =
  /** A user gesture. Captured by undo. */
  | 'local-gesture'
  /**
   * A local write that must never be undoable — a repair pass, a legacy-key back-write.
   * Distinct from `local-gesture` precisely so it can be excluded from the undo stack.
   */
  | 'local-transient'
  /** Arrived from a peer. Never captured; undoing a collaborator's work is the bug. */
  | 'remote'
  /**
   * Authored by the undo manager itself.
   *
   * This member exists because of a measured footgun: `Y.UndoManager` stamps its own
   * undo/redo transactions with `origin === theUndoManagerInstance` — not any class we
   * declared. Without a sentinel for it, an undo is reported to the renderer as a *remote*
   * change, and the local UI never learns its own Ctrl+Z happened.
   */
  | 'history'
  /** Initial load from persistence or IndexedDB. Never captured; not a user action. */
  | 'hydrate';

export interface Origin {
  readonly kind: OriginKind;
  /** Present only for `local-gesture`, tying the write to one gesture in the command log. */
  readonly gestureId?: string;
}

export type UndoDisposition = 'capture' | 'replay' | 'ignore';

/**
 * Contract for the undo-scope table.
 *
 * Mapped over {@link OriginKind}, so adding an origin is a **compile error** until its undo
 * disposition is declared. The tracked-origins set handed to `Y.UndoManager` must be
 * *derived* from this table rather than written out separately, or the two drift and the
 * failure is silent: a provider that omits an origin leaves `transaction.origin === null`,
 * which is in `trackedOrigins`' default set — so the undo manager captures and then undoes
 * a **collaborator's** work, which is the exact failure the feature promises to prevent.
 */
export type UndoScopeTable = Readonly<Record<OriginKind, UndoDisposition>>;

// ─────────────────────────────────────────────────────────────────────────────────────
// Dirty propagation
// ─────────────────────────────────────────────────────────────────────────────────────

declare const DirtyMaskBrand: unique symbol;

/** A set of invalidations, packed into a number. Constants are implementation. */
export type DirtyMask = number & { readonly [DirtyMaskBrand]: 'DirtyMask' };

/**
 * What a change invalidates.
 *
 * Keyed to *caches*, not to fields, because that is what the renderer actually rebuilds.
 * `order` is the only O(n log n) invalidation, and `existence` implies it — so a create
 * mid-gesture re-sorts the scene, which is correct and is why the two are separate flags.
 */
export type DirtyFlagName = 'geometry' | 'style' | 'ink' | 'order' | 'existence';

export type DirtyFlagTable = Readonly<Record<DirtyFlagName, DirtyMask>>;

/** Contract for the per-key invalidation table. Adding a shape key forces a decision here. */
export type KeyDirtyTable = Readonly<Record<ShapeKey, DirtyMask>>;

/**
 * What a listener is handed. Carries ids and masks and **no shapes** — deliberately.
 *
 * There is nothing here to draw *with*, so drawing inside an observer is unrepresentable
 * rather than merely discouraged. The listener marks ids dirty and returns; a single
 * `requestAnimationFrame` does the drawing. Two further guarantees:
 *
 *  - The return type is `void`, so a listener cannot be `async` and cannot defer work past
 *    the notification.
 *  - The view is **revoked when the notification returns**; every accessor throws
 *    afterwards. Retaining it would mean reading a snapshot that the next transaction has
 *    already invalidated.
 */
export interface DirtyView {
  readonly mask: DirtyMask;
  readonly ids: ReadonlySetLike<ShapeId>;
  readonly origin: Origin;
  /** True while a partition is unhealed, i.e. this replica holds unintegrated structs. */
  readonly stalled: boolean;
}

export type DirtyListener = (view: DirtyView) => void;
export type Unsubscribe = () => void;

/** Minimal read-only set surface, so an implementation is free to reuse its own container. */
export interface ReadonlySetLike<T> {
  readonly size: number;
  has: (value: T) => boolean;
  [Symbol.iterator]: () => IterableIterator<T>;
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Faults
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Something wrong that must be reported rather than thrown.
 *
 * The document is untrusted input: a `Y.Map` silently accepts NaN, a 10 MB string, and
 * `undefined` as a present key, and propagates all of it to every replica. A resolver that
 * threw would turn one bad shape from one bad peer into a blank board for everyone, so
 * faults are surfaced and counted instead. The counts are the operational signal — they are
 * how a broken peer is identified, and how you learn a legacy key has fallen out of use.
 */
export interface SceneFault {
  readonly at: number;
  readonly quirk: Quirk;
  /** Repaired and rendered, or dropped entirely. */
  readonly outcome: 'repaired' | 'dropped';
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Gestures
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The staging surface for one user gesture.
 *
 * `apply` may be called on every frame of a drag. Writes are **staged**, keyed by
 * `(shapeId, key)` with last-write-wins inside the gesture, and collapsed into a single
 * transaction on close. So a 300-frame drag produces one write per shape and its struct cost
 * is provably independent of frame count — which the property suite asserts directly.
 *
 * This is the only place a local write can originate: the origin required for a local write
 * carries a gesture id, and nothing exported mints one. The `gesture()` callback is the sole
 * route in.
 */
export interface GestureTx {
  /** Stage a command. Refusal is returned, not thrown — a rejected frame is normal. */
  readonly apply: (cmd: Command) => { readonly ok: true } | { readonly ok: false; readonly reason: RejectReason };
  /** Read the scene *as staged*, so a multi-frame gesture composes against its own effects. */
  readonly peek: (id: ShapeId) => Shape | undefined;
  /**
   * Abandon the gesture. Nothing is written, so no undo step is created and no wire
   * message is sent — which is what an Escape key must do.
   */
  readonly abort: () => void;
}

export interface GestureResult<T> {
  readonly value: T;
  /** False when the gesture was aborted or collapsed to nothing. */
  readonly committed: boolean;
  /**
   * Writes actually emitted after staging collapse and no-op suppression.
   *
   * Zero is a success, and suppressing it is not an optimisation: a drag that returns to its
   * starting position must cost no struct and must leave no dead Ctrl+Z on the stack.
   */
  readonly opCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Convergence probes
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Two digests, because one level is provably not enough.
 *
 * - `bytes` — hash of the encoded document, **re-encoded through a fresh `Y.Doc` first**.
 *   The raw encoding false-positives under `gc: true`: a client writing into a subtree it
 *   already knows is deleted leaves one replica holding a `GC` marker where another holds a
 *   deleted `Item`, so the bytes differ while state vectors and content are identical, and
 *   no amount of resyncing heals it. An invariant that fails on legal traffic gets disabled,
 *   so it is normalised.
 * - `content` — hash of the resolved scene in canonical order. Catches what the byte probe
 *   cannot: a `Date` converges at the byte level, because both sides encode `{}`, while the
 *   writer holds a real `Date` and every peer holds `{}`. A byte-only probe reports
 *   "converged" on a document that renders differently on every machine.
 *
 * Neither is a state-vector comparison, and that is the point: two docs sharing a clientID
 * converge on identical state vectors and *different* content — the one failure that
 * produces genuine permanent non-convergence.
 */
export interface SceneDigest {
  readonly bytes: string;
  readonly content: string;
  readonly shapeCount: number;
  /** Distinct writer ids the document has ever seen. A growth curve worth publishing. */
  readonly writerCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────────────
// The store
// ─────────────────────────────────────────────────────────────────────────────────────

export interface SceneStore {
  readonly get: (id: ShapeId) => Shape | undefined;
  readonly has: (id: ShapeId) => boolean;

  /**
   * Shapes in draw order.
   *
   * Sorted by `(idx, id)` — never by map iteration, which differs between byte-identical
   * replicas. Expected to be cached and invalidated by the `order` dirty flag.
   */
  readonly drawOrder: () => readonly Shape[];

  /** Candidate ids intersecting a board-space rect. A superset: the caller narrows it. */
  readonly query: (rect: Rect) => readonly ShapeId[];

  /**
   * Run one gesture. The only path to a local write.
   *
   * Re-entrancy is refused at runtime — a listener that calls back into `gesture` throws —
   * because TypeScript cannot express "not during this call". It is an invariant test, not a
   * type guarantee, and pretending otherwise would be worse than saying so.
   */
  readonly gesture: <T>(body: (tx: GestureTx) => T) => GestureResult<T>;

  /** Subscribe to dirty notifications. See {@link DirtyView} for what a listener may do. */
  readonly subscribe: (listener: DirtyListener) => Unsubscribe;

  /** Faults observed since the last drain. Report these; do not silently discard them. */
  readonly drainFaults: () => readonly SceneFault[];

  /**
   * Both convergence probes. O(document size), so this is a quiesce-time and test-time
   * call — never per frame.
   */
  readonly digest: () => SceneDigest;

  /**
   * True when this replica holds unintegrated structs.
   *
   * Surfaced rather than asserted away: mid-partition this is legitimate, and it is exactly
   * the causally-stalled state the sync indicator must distinguish from "disconnected". A
   * stalled client looks connected and silently stops updating, and because
   * `resyncInterval` defaults to `-1` nothing periodically heals it.
   */
  readonly stalled: () => boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Type-level assertions
// ─────────────────────────────────────────────────────────────────────────────────────

type Assert<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;

/** The seam's claims, asserted. */
export type StoreGuarantees = [
  // A listener cannot defer work past its notification.
  Assert<DirtyListener extends (view: DirtyView) => void ? true : false>,
  Assert<Not<DirtyListener extends (view: DirtyView) => Promise<void> ? true : false>>,
  // A dirty notification carries no shapes, so drawing inside an observer is impossible.
  Assert<Not<'shapes' extends keyof DirtyView ? true : false>>,
  Assert<Not<'get' extends keyof DirtyView ? true : false>>,
  // There is no write path that does not go through a gesture.
  Assert<Not<'apply' extends keyof SceneStore ? true : false>>,
  Assert<Not<'set' extends keyof SceneStore ? true : false>>,
  Assert<'gesture' extends keyof SceneStore ? true : false>,
];
