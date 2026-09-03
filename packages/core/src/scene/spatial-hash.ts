import { rectsIntersect, type Rect } from '../camera/camera.ts';

/**
 * A uniform spatial hash over board space, used for both culling and hit testing.
 *
 * Without one, both are O(n): a per-frame `shapes.filter(inViewport)` is pure bookkeeping
 * before a single pixel is drawn, and a hit test on every `pointermove` is a full scan at
 * up to 240Hz. Culling to the viewport is also not the same thing as making the scene
 * cheap — at zoom-to-fit, which is the first thing every user does, the cull removes
 * nothing and LOD is what carries the frame.
 *
 * ## Why a hash and not a quadtree or an R-tree
 *
 * On a whiteboard, shapes move *constantly* — that is the entire application. A move here
 * is remove-then-insert against a handful of `Set`s: O(cells covered), no rebalancing, no
 * tree surgery, no allocation beyond the cell sets themselves. An R-tree gives better
 * queries on a static scene and pays for it on every drag, and a quadtree splits and merges
 * nodes exactly when the user is dragging fastest.
 *
 * The classic weakness of a uniform grid is a heavy-tailed size distribution: one
 * board-sized frame shape would otherwise be inserted into tens of thousands of cells. That
 * is handled explicitly by {@link SpatialHash} keeping oversized items in a small
 * linearly-scanned list instead, so the grid never degenerates.
 *
 * ## What a query promises
 *
 * `query` returns a **superset** of the items whose bounds intersect the rectangle — a
 * candidate set, never a final answer. No false negatives, which is the only property a
 * cull needs; false positives are eliminated by the caller's AABB test and then by a
 * precise test. Making that contract explicit matters, because a caller that treats the
 * candidates as final gets subtly wrong hit testing on rotated or stroked shapes.
 */

/** Anything with an id and bounds can live in the index — deliberately not `Shape`. */
export interface Bounded<Id extends string = string> {
  readonly id: Id;
  readonly bounds: Rect;
}

/**
 * Cells an item may occupy before it is treated as oversized.
 *
 * 32 cells is a 4x8 or 6x6 footprint — comfortably more than a shape a user drew at a
 * normal zoom, and far less than the tens of thousands a full-board frame would claim.
 */
const DEFAULT_MAX_CELLS_PER_ITEM = 32;

/**
 * Default cell size in board units.
 *
 * The rule of thumb is 2-4x the median shape size: too small and a large shape touches
 * many cells, too large and every query returns most of the board. 256 suits shapes in the
 * 64-128 unit range, which is what the default rectangle and sticky sizes will be. Tune it
 * with real data rather than by reasoning — and measure the O(n)-scan-versus-index
 * comparison at 10k/100k/1M, which is a fair benchmark, unlike culling on versus off.
 */
const DEFAULT_CELL_SIZE = 256;

interface Entry {
  readonly bounds: Rect;
  /** Cell keys this item was filed under, so removal does not have to recompute them. */
  readonly cells: readonly string[];
  /** True when the item is in the oversized list rather than the grid. */
  readonly oversized: boolean;
}

/**
 * Cells a single query may visit before it gives up on the grid and scans linearly.
 *
 * This bound is not a safety valve, it is a correctness requirement, and it was found by a
 * property test crashing the worker. A grid query costs O(cells in the rect) *whether or
 * not those cells are occupied* — so a query spanning a large board visits millions of
 * empty cells and builds a string key for each. Zoom-to-fit produces exactly that rect,
 * which makes it the first thing every user does.
 *
 * Above the bound a linear scan over the entries is strictly better: it is O(items) rather
 * than O(area), and it returns an exact answer instead of a superset. The grid is an
 * optimisation for *small* queries, which is what a viewport at working zoom is.
 */
const DEFAULT_MAX_QUERY_CELLS = 4096;

export interface SpatialHashOptions {
  readonly cellSize?: number;
  readonly maxCellsPerItem?: number;
  readonly maxQueryCells?: number;
}

export class SpatialHash<Id extends string = string> {
  readonly #cellSize: number;
  readonly #maxCellsPerItem: number;
  readonly #maxQueryCells: number;

  /** cell key -> ids in that cell. */
  readonly #cells = new Map<string, Set<Id>>();
  /** id -> where it is filed, so `update` and `remove` need no search. */
  readonly #entries = new Map<Id, Entry>();
  /** Items too large for the grid, scanned linearly. Expected to stay small. */
  readonly #oversized = new Map<Id, Rect>();

  constructor(options: SpatialHashOptions = {}) {
    const cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError(`cellSize must be a positive finite number, got ${String(cellSize)}`);
    }
    this.#cellSize = cellSize;
    this.#maxCellsPerItem = options.maxCellsPerItem ?? DEFAULT_MAX_CELLS_PER_ITEM;
    this.#maxQueryCells = options.maxQueryCells ?? DEFAULT_MAX_QUERY_CELLS;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** How many items are in the linearly-scanned oversized list. Publish it; watch it. */
  get oversizedCount(): number {
    return this.#oversized.size;
  }

  /**
   * Insert or move an item.
   *
   * Idempotent, and correct when called with new bounds for an id already present — which
   * is the hot path, since it is what a drag does on every commit.
   */
  set(id: Id, bounds: Rect): void {
    const existing = this.#entries.get(id);
    if (existing) {
      // Nothing to do if it has not actually moved. Worth the four comparisons: a
      // multi-shape transaction re-sets every selected shape, and most of them often land
      // in the same cells.
      if (sameRect(existing.bounds, bounds)) return;
      this.#unfile(id, existing);
    }

    if (!isFiniteRect(bounds)) {
      // A NaN or infinite bound would produce a NaN cell key and quietly file the item
      // where no query can reach it. The index refuses instead: the CRDT accepts NaN
      // silently (measured), so this is where that stops being invisible.
      throw new RangeError(`bounds for ${id} are not finite: ${JSON.stringify(bounds)}`);
    }

    const span = this.#cellSpan(bounds);
    if (span > this.#maxCellsPerItem) {
      this.#oversized.set(id, bounds);
      this.#entries.set(id, { bounds, cells: [], oversized: true });
      return;
    }

    const cells = this.#cellKeys(bounds);
    for (const key of cells) {
      const bucket = this.#cells.get(key);
      if (bucket) bucket.add(id);
      else this.#cells.set(key, new Set([id]));
    }
    this.#entries.set(id, { bounds, cells, oversized: false });
  }

  /** Remove an item. Returns whether it was present. */
  delete(id: Id): boolean {
    const entry = this.#entries.get(id);
    if (!entry) return false;
    this.#unfile(id, entry);
    this.#entries.delete(id);
    return true;
  }

  has(id: Id): boolean {
    return this.#entries.has(id);
  }

  /** The bounds an item is currently filed under. */
  boundsOf(id: Id): Rect | undefined {
    return this.#entries.get(id)?.bounds;
  }

  clear(): void {
    this.#cells.clear();
    this.#entries.clear();
    this.#oversized.clear();
  }

  /**
   * Candidate ids whose bounds may intersect `rect`.
   *
   * A superset: no false negatives, some false positives. Follow it with an AABB reject and
   * then a precise test. Oversized items are always included, because by construction they
   * are too large to have been filed by cell.
   *
   * Returns a fresh array rather than an iterator on purpose — callers sort it into draw
   * order, and a lazy sequence that is invalidated by a concurrent `set` is a much worse
   * bug than one array allocation per frame.
   */
  query(queryRect: Rect): Id[] {
    // Normalise ONCE, here. A marquee dragged up and to the left produces negative
    // extents, and `rectsIntersect` assumes the documented non-negative convention — so
    // without this a selection box works in two directions only. Normalising at the
    // boundary costs four comparisons per query; doing it inside the intersection test
    // would cost four per item, on the cull path.
    const rect = normalise(queryRect);
    const found = new Set<Id>();

    if (isFiniteRect(rect)) {
      // A grid query costs O(cells in the rect) regardless of occupancy, so a query
      // spanning the board — which is what zoom-to-fit produces — would visit millions of
      // empty cells. Past the bound, scan the entries instead: O(items), and exact.
      if (this.#cellSpan(rect) > this.#maxQueryCells) {
        for (const [id, entry] of this.#entries) {
          if (rectsIntersect(entry.bounds, rect)) found.add(id);
        }
        return [...found];
      }

      const { minX, minY, maxX, maxY } = this.#cellRange(rect);
      for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const bucket = this.#cells.get(cellKey(cx, cy));
          if (!bucket) continue;
          for (const id of bucket) found.add(id);
        }
      }
    }

    // Cheap because the list is small by design; correctness does not depend on that, only
    // performance does.
    for (const [id, bounds] of this.#oversized) {
      if (rectsIntersect(bounds, rect)) found.add(id);
    }

    return [...found];
  }

  /**
   * Candidates at a point — the first tier of hit testing.
   *
   * `slop` widens the probe and must be supplied in **board units**; convert a screen-space
   * tolerance with `screenLengthToWorld` so a hairline stays clickable when zoomed out.
   */
  queryPoint(x: number, y: number, slop = 0): Id[] {
    return this.query({ x: x - slop, y: y - slop, w: slop * 2, h: slop * 2 });
  }

  /**
   * Ids whose bounds actually intersect a point probe. The exact counterpart of
   * {@link SpatialHash.queryPoint}.
   *
   * Worth having as its own method: `queryPoint` returns candidates by contract, and a
   * caller who forgets that gets a hit test which reports the nearest shape in the same
   * grid cell as a hit. That mistake is easy to make and hard to see.
   */
  queryPointExact(x: number, y: number, slop = 0): Id[] {
    return this.queryExact({ x: x - slop, y: y - slop, w: slop * 2, h: slop * 2 });
  }

  /** Ids whose bounds actually intersect `rect`, with the AABB reject already applied. */
  queryExact(queryRect: Rect): Id[] {
    const rect = normalise(queryRect);
    const result: Id[] = [];
    for (const id of this.query(rect)) {
      const bounds = this.#entries.get(id)?.bounds;
      if (bounds && rectsIntersect(bounds, rect)) result.push(id);
    }
    return result;
  }

  /** Occupied-cell count. A useful health number: it should track shape count, not exceed it wildly. */
  get cellCount(): number {
    return this.#cells.size;
  }

  #unfile(id: Id, entry: Entry): void {
    if (entry.oversized) {
      this.#oversized.delete(id);
      return;
    }
    for (const key of entry.cells) {
      const bucket = this.#cells.get(key);
      if (!bucket) continue;
      bucket.delete(id);
      // Reclaim empty buckets, or a board that has been panned across for an hour keeps a
      // cell for every position anything ever occupied.
      if (bucket.size === 0) this.#cells.delete(key);
    }
  }

  #cellRange(rect: Rect): { minX: number; minY: number; maxX: number; maxY: number } {
    const size = this.#cellSize;
    // Normalise: a negative width would otherwise give max < min and silently match nothing.
    const x0 = Math.min(rect.x, rect.x + rect.w);
    const y0 = Math.min(rect.y, rect.y + rect.h);
    const x1 = Math.max(rect.x, rect.x + rect.w);
    const y1 = Math.max(rect.y, rect.y + rect.h);
    return {
      minX: Math.floor(x0 / size),
      minY: Math.floor(y0 / size),
      maxX: Math.floor(x1 / size),
      maxY: Math.floor(y1 / size),
    };
  }

  #cellSpan(rect: Rect): number {
    const { minX, minY, maxX, maxY } = this.#cellRange(rect);
    return (maxX - minX + 1) * (maxY - minY + 1);
  }

  #cellKeys(rect: Rect): string[] {
    const { minX, minY, maxX, maxY } = this.#cellRange(rect);
    const keys: string[] = [];
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) keys.push(cellKey(cx, cy));
    }
    return keys;
  }
}

/**
 * Cell key.
 *
 * A string rather than a packed integer: packing two signed cell coordinates into one
 * number means either a bit-width limit on board size or a `Map` keyed by a float, and a
 * board is unbounded by design. `Map<string, …>` lookups are fast enough that this has
 * never been the bottleneck in a profile — but it is the first thing to revisit if the cull
 * ever shows up in one, and the change is contained to these two functions.
 */
const cellKey = (cx: number, cy: number): string => {
  return `${String(cx)}:${String(cy)}`;
};

/** Rewrite a rect so `w` and `h` are non-negative, per the documented {@link Rect} convention. */
const normalise = (rect: Rect): Rect => {
  if (rect.w >= 0 && rect.h >= 0) return rect;
  return {
    x: Math.min(rect.x, rect.x + rect.w),
    y: Math.min(rect.y, rect.y + rect.h),
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  };
};

const sameRect = (a: Rect, b: Rect): boolean => {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
};

const isFiniteRect = (rect: Rect): boolean => {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.w) &&
    Number.isFinite(rect.h)
  );
};

/**
 * Bulk-build an index. Marginally faster than repeated `set` because it skips the
 * already-present checks, and it is the cold-load path — so it is also the thing to chunk
 * across frames behind a first paint rather than run in one uninterruptible task.
 */
export const buildSpatialHash = <Id extends string = string>(
  items: Iterable<Bounded<Id>>,
  options?: SpatialHashOptions,
): SpatialHash<Id> => {
  const index = new SpatialHash<Id>(options);
  for (const item of items) index.set(item.id, item.bounds);
  return index;
};
