import type {
  Finite,
  FracIdx,
  PackedInk,
  Quirk,
  ResolveShape,
  SchemaVersion,
  ShapeKind,
  Style,
  Transform,
} from './shape.ts';
import {
  MAX_INK_LENGTH,
  MAX_TEXT_LENGTH,
  SCHEMA_VERSION,
  ZERO,
  checkFinite,
  checkText,
  finite,
  isRecord,
} from './validate.ts';

/**
 * The read-time resolver — the only thing between the document and the renderer.
 *
 * **Total, and it never throws.** That is the requirement, not a nicety: this runs over
 * content a peer wrote, and a resolver that threw would let one broken peer turn one bad
 * shape into a blank board for everyone. So a fault becomes a repair plus a {@link Quirk},
 * and `shape` comes back undefined only when there is genuinely nothing renderable left.
 *
 * Every repair is a **constant**, never a guess derived from other shapes. All replicas
 * resolve the same record to the same shape without talking to each other, which is what
 * keeps the content digest meaningful — a repair that consulted neighbours would resolve
 * differently on every replica and report divergence that is not there.
 *
 * Quirks are reported in key order, and the counts are the point: they are how you find out
 * a peer is broken, and how you find out when a key has finally fallen out of use.
 */

/** Records one quirk per `(key, reason)`, so a repeated fault on one key is reported once. */
type Note = (key: Quirk['key'], reason: Quirk['reason']) => void;

const REPAIR_IDX = 'a0' as FracIdx;

/**
 * The style a shape falls back to.
 *
 * Black on transparent: visible against the board on every theme, and visibly not a choice
 * anyone made, so a shape wearing it is findable by eye as well as through the quirk count.
 */
const REPAIR_STYLE: Style = {
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: finite(1),
  opacity: finite(1),
};

/** An unfamiliar version is still read — additive-only migration is what makes that safe. */
const resolveVersion = (value: unknown, note: Note): SchemaVersion => {
  if (value === SCHEMA_VERSION) return SCHEMA_VERSION;
  if (value === undefined) note('v', 'missing');
  else if (typeof value !== 'number') note('v', 'wrong-type');
  else note('v', 'out-of-range');
  return SCHEMA_VERSION;
};

/** No usable kind means nothing renderable, so this is one of the two undefined-shape cases. */
const resolveKind = (value: unknown, note: Note): ShapeKind | undefined => {
  if (value === 'rect' || value === 'pen') return value;
  if (value === undefined) note('kind', 'missing');
  else if (typeof value !== 'string') note('kind', 'wrong-type');
  else note('kind', 'unknown-kind');
  return undefined;
};

const resolveCoord = (value: unknown, note: Note): Finite => {
  const checked = checkFinite(value);
  if (checked.ok) return checked.value;
  note('t', checked.fault);
  return ZERO;
};

/**
 * Geometry, repaired field by field.
 *
 * A `t` that is not a bag of keys at all has no geometry to repair and returns undefined —
 * the other of the two undefined-shape cases. A `t` that *is* one has each field repaired
 * independently, because a single NaN coordinate is not a reason to lose a shape's size.
 */
const resolveTransform = (value: unknown, note: Note): Transform | undefined => {
  if (!isRecord(value)) {
    note('t', value === undefined ? 'missing' : 'wrong-type');
    return undefined;
  }
  return {
    x: resolveCoord(value['x'], note),
    y: resolveCoord(value['y'], note),
    w: resolveCoord(value['w'], note),
    h: resolveCoord(value['h'], note),
    rot: resolveCoord(value['rot'], note),
  };
};

/**
 * Draw order, repaired to a constant.
 *
 * Not a generated key: this function is pure, so it has neither an rng nor the neighbours to
 * place one between. Every replica repairs to the same index, and `compareDrawOrder`'s `id`
 * tie-break then orders the repaired shapes identically everywhere.
 */
const resolveIdx = (value: unknown, note: Note): FracIdx => {
  const checked = checkText(value, MAX_TEXT_LENGTH);
  if (checked.ok && checked.value.length > 0) return checked.value as FracIdx;
  note('idx', checked.ok ? 'missing' : checked.fault);
  return REPAIR_IDX;
};

/** Attribution is truncated rather than dropped: a name worth keeping arrived inside the 10 MB. */
const resolveAuthor = (value: unknown, note: Note): string => {
  const checked = checkText(value, MAX_TEXT_LENGTH);
  if (checked.ok) return checked.value;
  note('author', checked.fault);
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_LENGTH) : '';
};

const resolveStyle = (value: unknown, note: Note): Style => {
  if (!isRecord(value)) {
    note('style', value === undefined ? 'missing' : 'wrong-type');
    return REPAIR_STYLE;
  }

  const text = (field: unknown, fallback: string): string => {
    const checked = checkText(field, MAX_TEXT_LENGTH);
    if (checked.ok) return checked.value;
    note('style', checked.fault);
    return fallback;
  };
  const measure = (field: unknown, fallback: Finite): Finite => {
    const checked = checkFinite(field);
    if (checked.ok) return checked.value;
    note('style', checked.fault);
    return fallback;
  };

  return {
    fill: text(value['fill'], REPAIR_STYLE.fill),
    stroke: text(value['stroke'], REPAIR_STYLE.stroke),
    strokeWidth: measure(value['strokeWidth'], REPAIR_STYLE.strokeWidth),
    opacity: measure(value['opacity'], REPAIR_STYLE.opacity),
  };
};

/**
 * Packed ink, all or nothing.
 *
 * The one value with no sensible repair: a stroke's points cannot be guessed, and a pen shape
 * with a substituted path is a line the user never drew. So unusable ink is the third and
 * last undefined-shape case.
 */
const resolveInk = (value: unknown, note: Note): PackedInk | undefined => {
  if (!isRecord(value)) {
    note('ink', value === undefined ? 'missing' : 'wrong-type');
    return undefined;
  }

  const d = checkText(value['d'], MAX_INK_LENGTH);
  if (!d.ok) {
    note('ink', d.fault);
    return undefined;
  }
  const q = checkFinite(value['q']);
  if (!q.ok) {
    note('ink', q.fault);
    return undefined;
  }
  const n = checkFinite(value['n']);
  if (!n.ok) {
    note('ink', n.fault);
    return undefined;
  }

  return { q: q.value, d: d.value, n: n.value };
};

export const resolveShape: ResolveShape = (id, raw) => {
  const quirks: Quirk[] = [];
  const note: Note = (key, reason) => {
    // One per (key, reason): a `t` with three NaN fields is one broken value, not three.
    if (!quirks.some((quirk) => quirk.key === key && quirk.reason === reason)) {
      quirks.push({ id, key, reason });
    }
  };

  // Resolved in key order, and every key is resolved even when an earlier one has already
  // failed: the quirk list is a report on the whole record, so it must not depend on which
  // fault happened to be found first.
  const v = resolveVersion(raw.v, note);
  const kind = resolveKind(raw.kind, note);
  const t = resolveTransform(raw.t, note);
  const idx = resolveIdx(raw.idx, note);
  const author = resolveAuthor(raw.author, note);
  const style = resolveStyle(raw.style, note);

  if (kind === undefined || t === undefined) return { shape: undefined, quirks };

  if (kind === 'pen') {
    const ink = resolveInk(raw.ink, note);
    if (ink === undefined) return { shape: undefined, quirks };
    return { shape: { id, v, kind, t, idx, author, style, ink }, quirks };
  }

  return { shape: { id, v, kind, t, idx, author, style }, quirks };
};
