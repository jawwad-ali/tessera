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
