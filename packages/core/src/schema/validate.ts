import { COORD_LIMIT } from './bounds.ts';
import type { Finite, Quirk, SchemaVersion } from './shape.ts';

/**
 * The value guards for untrusted document content.
 *
 * These run at the **observer** boundary, not the write boundary. Our own writes are already
 * well-typed; the values that need checking are the ones a peer sent, and a hostile peer
 * skips our write path entirely. A `Y.Map` accepts `NaN`, `Infinity`, `undefined` as a
 * present key, a string in a numeric field and a 10 MB string, silently, and replicates
 * every one of them to every replica.
 *
 * Nothing here throws and nothing here reports "invalid". Each guard returns either a
 * narrowed value or the named fault, and {@link ./migrate.ts} turns a fault into a repair
 * plus a {@link Quirk}. That split is deliberate: a guard that threw would hand one broken
 * peer the power to blank everyone's board.
 */

/** The current schema version. Bumped only when the *set* of keys changes. */
export const SCHEMA_VERSION: SchemaVersion = 1;

/**
 * Longest string the schema accepts in any text field.
 *
 * Bounds what one peer can force every other peer to hold and to lay out. 256 is far above
 * any real author name, colour or fractional index — the longest index this app can generate
 * grows by roughly one character per doubling of a board's shape count.
 */
export const MAX_TEXT_LENGTH = 256;

/**
 * Longest packed-ink payload the schema accepts.
 *
 * A stroke is base64 of int16 deltas, so this is around 375,000 points — orders of magnitude
 * beyond a real freehand stroke, and it still bounds the memory one peer can force.
 */
export const MAX_INK_LENGTH = 1_000_000;

/**
 * The faults a value can have, drawn from {@link Quirk} so the two cannot drift.
 *
 * `unknown-kind` and `legacy-form` are absent because neither is a property of a *value*:
 * the first is a property of the kind key's contents and the second of the key set.
 */
export type ValueFault = Extract<
  Quirk['reason'],
  'missing' | 'wrong-type' | 'not-finite' | 'out-of-range' | 'too-long'
>;

/** A guard's answer: the narrowed value, or the fault that stopped it being one. */
export type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fault: ValueFault };

/**
 * Brand a number this module has already established is finite and in range.
 *
 * The one place `Finite` is minted rather than narrowed, so grepping for it finds exactly
 * one line. Every other `Finite` in the codebase traces back through here.
 */
export const finite = (value: number): Finite => value as Finite;

/** Zero, branded. What every numeric repair substitutes. */
export const ZERO: Finite = finite(0);

/**
 * A number that the geometry arithmetic can survive.
 *
 * The range check is not belt-and-braces on top of the finiteness check — it is the reason
 * {@link COORD_LIMIT} exists. Every field of `{x: 1e308, w: 1.7e308}` is finite and passes
 * `Number.isFinite`, and the axis-aligned box derived from them is `Infinity`, which
 * `SpatialHash` refuses by throwing. A finite-only guard admits the shape that crashes the
 * insert.
 *
 * `-0` passes, deliberately. It is ordinary arithmetic for a rotation, it is the same shape
 * on screen as `0`, and a guard written as `value > 0 || value < 0` would repair a correct
 * shape and report a fault that is not one.
 */
export const checkFinite = (value: unknown): Checked<Finite> => {
  if (value === undefined) return { ok: false, fault: 'missing' };
  if (typeof value !== 'number') return { ok: false, fault: 'wrong-type' };
  if (!Number.isFinite(value)) return { ok: false, fault: 'not-finite' };
  if (Math.abs(value) > COORD_LIMIT) return { ok: false, fault: 'out-of-range' };
  return { ok: true, value: finite(value) };
};

/** A string within its length budget. */
export const checkText = (value: unknown, max: number): Checked<string> => {
  if (value === undefined) return { ok: false, fault: 'missing' };
  if (typeof value !== 'string') return { ok: false, fault: 'wrong-type' };
  if (value.length > max) return { ok: false, fault: 'too-long' };
  return { ok: true, value };
};

/**
 * Whether a value can be read as a bag of keys.
 *
 * Arrays and class instances pass, and that is correct rather than sloppy: a `Date` written
 * to the document arrives at every other replica as `{}`, so the observer's job is to read
 * whatever fields are actually there and report the ones that are missing.
 */
export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;
