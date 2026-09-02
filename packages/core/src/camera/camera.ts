/**
 * The camera: a 2D affine transform between screen space and board space, plus the
 * arithmetic every interaction and every draw call goes through.
 *
 * This is the most reused math in the codebase and the place off-by-a-zoom-factor bugs
 * live, so it is pure, allocation-light, and tested by properties rather than examples.
 *
 * Two deliberate choices worth defending:
 *
 * **No `DOMMatrix`.** `packages/core` declares no DOM lib (ARCHITECTURE.md §3), so
 * `DOMMatrix` is not merely unavailable, it is out of bounds. That is the right constraint
 * rather than an obstacle: an `OffscreenCanvas` worker renderer needs the scene as plain
 * cloneable data, and `DOMMatrix` is not structured-cloneable. A six-number record is, and
 * it drops straight into `ctx.setTransform(a, b, c, d, e, f)` with no conversion.
 *
 * **Device pixel ratio is folded into the matrix**, never applied as a separate
 * `ctx.scale(dpr, dpr)`. One transform means one source of truth: hit testing, culling and
 * drawing cannot disagree about whether dpr has been applied yet, which is the bug that
 * makes a pointer land half a shape away on a HiDPI screen at non-integer zoom.
 */

/** A point, in whichever space the surrounding code says. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned rectangle. `w`/`h` are non-negative by convention. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * A 2D affine transform in the same column order Canvas2D uses, so it can be spread
 * straight into `setTransform`:
 *
 *   | a c e |
 *   | b d f |
 *   | 0 0 1 |
 */
export interface Mat2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/**
 * The camera itself: the board-space point at the viewport's top-left, and a scale.
 *
 * Storing the corner rather than the centre is what makes `screenToWorld` two multiplies
 * and two adds with no viewport size involved — and the viewport is exactly the thing that
 * is in flux while a `ResizeObserver` is mid-callback.
 *
 * Rotation is deliberately absent. No shipped whiteboard rotates the canvas, and carrying
 * an unused rotation term through every hit test and cull would cost real arithmetic on the
 * hot path for a feature nobody asks for. Adding it later means changing this file and the
 * two functions that construct matrices, which is a contained change.
 */
export interface Camera {
  /** Board-space x at the viewport's left edge. */
  readonly x: number;
  /** Board-space y at the viewport's top edge. */
  readonly y: number;
  /** Board units to CSS pixels. 1 means 1 board unit is 1 CSS pixel. */
  readonly zoom: number;
}

/**
 * Zoom bounds.
 *
 * The floor is not arbitrary: below roughly 1/64 a board of any size is a few pixels of
 * grey mush, and everything that scales inversely with zoom — stroke widths as
 * `w / zoom`, hit slop as `10 / zoom` — starts producing absurd numbers. The ceiling keeps
 * `1 / zoom` well away from the range where float error becomes visible as jitter.
 */
export const MIN_ZOOM = 0.015_625; // 1/64
export const MAX_ZOOM = 64;

export const IDENTITY: Mat2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** The camera showing the board's origin at 1:1. */
export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** Clamp a zoom value into the supported range. NaN collapses to 1 rather than propagating. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Board space to CSS-pixel screen space.
 *
 * Note this returns CSS pixels, not device pixels: pointer events arrive in CSS pixels, and
 * so do the fixed-size selection handles drawn in screen space. Device pixels enter only in
 * {@link deviceMatrix}, at the single point where the canvas transform is set.
 */
export function worldToScreen(camera: Camera, point: Vec2): Vec2 {
  return {
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom,
  };
}

/** CSS-pixel screen space to board space. Exact inverse of {@link worldToScreen}. */
export function screenToWorld(camera: Camera, point: Vec2): Vec2 {
  return {
    x: point.x / camera.zoom + camera.x,
    y: point.y / camera.zoom + camera.y,
  };
}

/**
 * The transform to hand to `ctx.setTransform`, with device pixel ratio folded in.
 *
 * Cap `dpr` before calling: past about 2 nobody can see the difference and you are paying
 * the square of it in fill rate. Rendering at a reduced dpr while the pointer is down and
 * at full dpr on idle is a real, measurable technique — and it only works if dpr lives in
 * one place, which is here.
 */
export function deviceMatrix(camera: Camera, dpr: number): Mat2D {
  const scale = camera.zoom * dpr;
  return {
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    e: -camera.x * scale,
    f: -camera.y * scale,
  };
}

/** Invert an affine transform. Returns `undefined` if it is singular (zero determinant). */
export function invert(matrix: Mat2D): Mat2D | undefined {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (determinant === 0 || !Number.isFinite(determinant)) return undefined;

  const inverseDeterminant = 1 / determinant;
  const a = matrix.d * inverseDeterminant;
  const b = -matrix.b * inverseDeterminant;
  const c = -matrix.c * inverseDeterminant;
  const d = matrix.a * inverseDeterminant;
  return {
    a,
    b,
    c,
    d,
    e: -(matrix.e * a + matrix.f * c),
    f: -(matrix.e * b + matrix.f * d),
  };
}

/** Apply an affine transform to a point. */
export function applyMatrix(matrix: Mat2D, point: Vec2): Vec2 {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

/**
 * Zoom by a factor while keeping one screen point pinned to the board point beneath it.
 *
 * This is the whole feel of a canvas app. Zooming about the viewport centre — the naive
 * implementation — makes the content slide out from under the cursor, and users read that
 * as the app fighting them.
 *
 * The invariant is exact and is worth stating as one, because it is what the property test
 * asserts: for any camera, any anchor and any factor,
 * `screenToWorld(zoomAbout(camera, anchor, k), anchor)` equals
 * `screenToWorld(camera, anchor)`. It holds even when the factor is clamped, which is the
 * case a naive implementation gets wrong: clamping the zoom without recomputing the offset
 * pins the wrong point and the board drifts every time a user hits the zoom limit.
 */
export function zoomAbout(camera: Camera, anchorScreen: Vec2, factor: number): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  // Derived from the effective zoom, not the requested one, so clamping cannot desync the
  // anchor.
  const anchorWorld = screenToWorld(camera, anchorScreen);
  return {
    x: anchorWorld.x - anchorScreen.x / zoom,
    y: anchorWorld.y - anchorScreen.y / zoom,
    zoom,
  };
}

/** Set an absolute zoom while keeping a screen point pinned. */
export function zoomToAbout(camera: Camera, anchorScreen: Vec2, targetZoom: number): Camera {
  const zoom = clampZoom(targetZoom);
  const anchorWorld = screenToWorld(camera, anchorScreen);
  return {
    x: anchorWorld.x - anchorScreen.x / zoom,
    y: anchorWorld.y - anchorScreen.y / zoom,
    zoom,
  };
}

/** Pan by a screen-space delta. Zoom-independent, so a drag tracks the pointer exactly. */
export function panByScreen(camera: Camera, deltaScreen: Vec2): Camera {
  return {
    x: camera.x - deltaScreen.x / camera.zoom,
    y: camera.y - deltaScreen.y / camera.zoom,
    zoom: camera.zoom,
  };
}

/**
 * The board-space rectangle currently visible, given the viewport in CSS pixels.
 *
 * This is the cull query. `padding` inflates it in board units — pass a value large enough
 * to cover the widest stroke half-width on screen, or shapes whose geometry is offscreen
 * but whose stroke or shadow reaches into the viewport will pop in at the edges.
 */
export function visibleWorldRect(camera: Camera, viewportCss: Vec2, padding = 0): Rect {
  const w = viewportCss.x / camera.zoom;
  const h = viewportCss.y / camera.zoom;
  return {
    x: camera.x - padding,
    y: camera.y - padding,
    w: w + padding * 2,
    h: h + padding * 2,
  };
}

/**
 * A camera that fits `content` inside `viewportCss` with a margin, in CSS pixels.
 *
 * Zoom-to-fit is the first thing every user does, and it is also the renderer's worst case
 * — culling removes nothing, so LOD is what carries it. Empty or degenerate content yields
 * the default camera rather than an infinity.
 */
export function fitToContent(content: Rect, viewportCss: Vec2, marginCss = 32): Camera {
  if (content.w <= 0 || content.h <= 0) return DEFAULT_CAMERA;
  if (viewportCss.x <= 0 || viewportCss.y <= 0) return DEFAULT_CAMERA;

  const usableW = Math.max(1, viewportCss.x - marginCss * 2);
  const usableH = Math.max(1, viewportCss.y - marginCss * 2);
  const zoom = clampZoom(Math.min(usableW / content.w, usableH / content.h));

  // Centre the content: split the leftover viewport, in board units, on both sides.
  const boardViewW = viewportCss.x / zoom;
  const boardViewH = viewportCss.y / zoom;
  return {
    x: content.x + content.w / 2 - boardViewW / 2,
    y: content.y + content.h / 2 - boardViewH / 2,
    zoom,
  };
}

/** Do two rectangles overlap? Touching edges count, which is what a cull wants. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** Is a point inside a rectangle? Edge-inclusive, matching {@link rectsIntersect}. */
export function rectContains(rect: Rect, point: Vec2): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

/**
 * Convert a screen-space length to board units.
 *
 * Use it for anything that must stay a fixed size on screen regardless of zoom: hit slop
 * on a thin line (`screenLengthToWorld(camera, 10)`), and stroke-width compensation when
 * drawing a shape-space path under a scaled transform. Getting this backwards is why
 * hairlines become unclickable when zoomed out.
 */
export function screenLengthToWorld(camera: Camera, cssPixels: number): number {
  return cssPixels / camera.zoom;
}

/** Are two cameras equal? Cheap gate for "does this frame need redrawing at all". */
export function cameraEquals(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}
