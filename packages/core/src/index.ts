/**
 * The scene, the schema, the geometry, the rules.
 *
 * Imports no yjs, no react and no node — enforced by `pnpm arch` for modules and by
 * `pnpm typecheck:pure` for platform globals (ARCHITECTURE.md §3, invariant 1). That single
 * rule is what lets the convergence suite drive the real command vocabulary against N
 * in-process replicas with no browser and no CRDT, and it is why the camera below carries
 * its own affine type instead of using `DOMMatrix`.
 */

// ── Contracts ─────────────────────────────────────────────────────────────────────
// Types only. These files declare no runtime values and erase to nothing; the
// implementation phase writes functions that satisfy the exported function types, so a
// contract cannot drift from its implementation without a compile error.

export type {
  CompareDrawOrder,
  DocValue,
  EncodeShape,
  Finite,
  FracIdx,
  KeyClass,
  KeyClassTable,
  LegacyShapeKey,
  PackedInk,
  PenShape,
  Quirk,
  RawShape,
  RectShape,
  Resolved,
  ResolveShape,
  SchemaGuarantees,
  SchemaVersion,
  Shape,
  ShapeBase,
  ShapeBounds,
  ShapeDraft,
  ShapeId,
  ShapeKey,
  ShapeKind,
  Style,
  Transform,
} from './schema/shape.ts';

export type {
  CheckPatch,
  Command,
  CommandGuarantees,
  CommandKind,
  CommandTargets,
  CommandTouches,
  CommitStamp,
  CreateCommand,
  DeleteCommand,
  IdxBetween,
  Inverse,
  Invert,
  LossReason,
  NonEmpty,
  Patch,
  PatchOp,
  Reduce,
  ReduceResult,
  RejectReason,
  ReorderCommand,
  RestyleCommand,
  Rng,
  ScenePeek,
  SelectionBounds,
  TransformCommand,
} from './commands/command.ts';

export type {
  DirtyFlagName,
  DirtyFlagTable,
  DirtyListener,
  DirtyMask,
  DirtyView,
  GestureResult,
  GestureTx,
  KeyDirtyTable,
  Origin,
  OriginKind,
  ReadonlySetLike,
  SceneDigest,
  SceneFault,
  SceneStore,
  StoreGuarantees,
  Unsubscribe,
  UndoDisposition,
  UndoScopeTable,
} from './scene/store.ts';

// ── Implementations ───────────────────────────────────────────────────────────────

export {
  DEFAULT_CAMERA,
  IDENTITY,
  MAX_ZOOM,
  MIN_ZOOM,
  applyMatrix,
  cameraEquals,
  clampZoom,
  deviceMatrix,
  fitToContent,
  invert,
  panByScreen,
  rectContains,
  rectsIntersect,
  screenLengthToWorld,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomAbout,
  zoomToAbout,
} from './camera/camera.ts';
export type { Camera, Mat2D, Rect, Vec2 } from './camera/camera.ts';

// The schema boundary: guards in, repairs out, encoding back.
export { COORD_LIMIT, shapeCorners, transformBounds } from './schema/bounds.ts';
export {
  MAX_INK_LENGTH,
  MAX_TEXT_LENGTH,
  SCHEMA_VERSION,
  ZERO,
  checkFinite,
  checkText,
  finite,
  isRecord,
} from './schema/validate.ts';
export type { Checked, ValueFault } from './schema/validate.ts';
export { resolveShape } from './schema/migrate.ts';
export { encodeShape, encodeStyleValue, encodeTransformValue } from './schema/encode.ts';
export { HOT_KEYS, KEY_CLASS } from './schema/keys.ts';

// The write vocabulary.
export { COMMAND_TOUCHES, checkPatch, missingTarget, reduce, stampShape } from './commands/apply.ts';

// The scene.
export { compareDrawOrder, idxBetween } from './scene/order.ts';
export type { Ordered } from './scene/order.ts';
export { DIRTY_EXISTENCE, DIRTY_FLAGS, DIRTY_NONE, KEY_DIRTY, combine } from './scene/dirty.ts';
export { createMemoryStore } from './scene/memory-store.ts';
export type { MemoryStoreOptions } from './scene/memory-store.ts';
export { SpatialHash } from './scene/spatial-hash.ts';

// The assertions the property suite runs.
export { checkCommand, checkScene } from './invariants.ts';
export type { InvariantName, Violation } from './invariants.ts';
