import { describe as group, expect, it } from 'vitest';

import type { Command, Patch, PatchOp, ScenePeek } from './command.ts';
import type { FracIdx, Shape, ShapeDraft, ShapeId, Style, Transform } from '../schema/shape.ts';
import { COMMAND_TOUCHES, checkPatch, reduce } from './apply.ts';

/**
 * The write vocabulary, and the rules a patch has to obey to be one.
 *
 * The describe names match the verifiers in PHASES.md (`-t checkPatch`, `-t encodeShape`).
 *
 * `checkPatch` is not a second validator. `reduce` decides whether a *command* is legal;
 * this decides whether the *patch* a command produced obeys the architecture's own rules —
 * one hot key per command, no key removal, no relative op, nothing outside the declared
 * footprint. It exists so that a contributor who adds a command finds out at test time
 * instead of at incident time, and so the property suite can assert it on generated input.
 */

const id = 's1' as ShapeId;
const other = 's2' as ShapeId;

const t = { x: 5, y: 20, w: 10, h: 10, rot: 0 } as unknown as Transform;
const style = {
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 1,
  opacity: 1,
} as unknown as Style;

const existing: Shape = { id, v: 1, kind: 'rect', t, idx: 'a0' as FracIdx, author: 'u1', style };

const scene: ScenePeek = {
  get: (wanted) => (wanted === id ? existing : undefined),
  has: (wanted) => wanted === id,
};

const stamp = { author: 'u1', at: 0 };

/** One of each. The patches these produce are what `checkPatch` must find nothing wrong with. */
const EVERY_COMMAND: readonly Command[] = [
  {
    kind: 'create',
    draft: { id: other, kind: 'rect', t, idx: 'a1' as FracIdx, style },
  },
  { kind: 'transform', entries: [{ id, t }] },
  { kind: 'restyle', entries: [{ id, style }] },
  { kind: 'reorder', entries: [{ id, idx: 'a2' as FracIdx }] },
  { kind: 'delete', ids: [id] },
];

const patchOf = (command: Command): Patch => {
  const result = reduce(scene, command, stamp);
  if (!result.ok) throw new Error(`${command.kind} was refused: ${result.reason}`);
  return result.patch;
};

group('checkPatch', () => {
  it.skip('passes every patch the five real commands actually produce', () => {
    for (const command of EVERY_COMMAND) {
      expect(checkPatch(command.kind, patchOf(command), COMMAND_TOUCHES), command.kind).toEqual([]);
    }
  });

  it('refuses a command that writes geometry and style together', () => {
    // The declared footprint is passed in, so this is the contributor's own declaration: they
    // added a command that changes both and said so. The measurement is what refuses it —
    // writing `t` and `style` on one shape in a frame costs +120 structs instead of +2,
    // because a repeated write merges only if it is the only thing that client wrote.
    const patch: Patch = [
      { op: 'set', id, key: 't', value: { x: 1, y: 1, w: 10, h: 10, rot: 0 } },
      { op: 'set', id, key: 'style', value: { fill: '#f00', stroke: '#000', strokeWidth: 1, opacity: 1 } },
    ];

    const violations = checkPatch('transform', patch, {
      ...COMMAND_TOUCHES,
      transform: ['t', 'style'],
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.violation).toContain('hot');
    // Reported against the op that broke the budget, not the first one — the second hot key
    // is the one a contributor has to remove.
    expect(violations[0]?.op).toEqual(patch[1]);
  });

  it('refuses an op shaped like a key removal', () => {
    // Not representable in the type — `DocValue` has no `undefined` — so it can only arrive
    // by a cast, which is exactly how a hand-written patch or a generated one arrives. A
    // concurrent `set` always beats a `delete` on a map key, so a key removal is a write
    // that loses; deletion has to be a parent drop.
    const patch = [{ op: 'set', id, key: 't', value: undefined }] as unknown as Patch;

    const violations = checkPatch('transform', patch, COMMAND_TOUCHES);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.violation).toContain('removal');
  });

  it('refuses an op that is not one of the three absolute writes', () => {
    const patch = [{ op: 'incr', id, key: 't', by: 1 }] as unknown as Patch;

    const violations = checkPatch('transform', patch, COMMAND_TOUCHES);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.violation).toContain('absolute');
  });

  it('refuses a patch that writes outside its declared footprint', () => {
    // The drift the table exists to catch: a command's implementation grows a key its
    // declaration never mentioned. Green typechecks, silently wider write.
    const patch: Patch = [{ op: 'set', id, key: 'author', value: 'someone-else' }];

    const violations = checkPatch('transform', patch, COMMAND_TOUCHES);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.violation).toContain('footprint');
  });

  it('refuses a whole-container write outside its declared footprint', () => {
    // The other half of the same rule. A command that starts emitting a `put` writes every
    // key at once, so its footprint has to cover all of them or the widened write is silent.
    const patch: Patch = [{ op: 'put', id, values: { t: { x: 0, y: 0, w: 1, h: 1, rot: 0 }, author: 'x' } }];

    const violations = checkPatch('transform', patch, COMMAND_TOUCHES);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.violation).toContain("'author'");
  });

  it('holds every command to a one-hot-key footprint', () => {
    // The table is data, so it can drift on its own. This asserts the declarations, not a
    // patch: no command may *declare* more than one hot key through `set`, and a create is
    // exempt because it is one whole-container `put` however many keys it carries.
    const hot: readonly string[] = ['t', 'style'];
    for (const [kind, keys] of Object.entries(COMMAND_TOUCHES)) {
      if (kind === 'create') continue;
      expect(keys.filter((key) => hot.includes(key)).length, kind).toBeLessThanOrEqual(1);
    }
  });
});

group('reduce', () => {
  it('refuses a command naming a shape that is not there', () => {
    const result = reduce(scene, { kind: 'transform', entries: [{ id: other, t }] }, stamp);

    expect(result).toEqual({ ok: false, reason: 'unknown-shape', id: other });
  });

  it('stamps the author from the commit, never from the draft', () => {
    const result = reduce(
      scene,
      { kind: 'create', draft: { id: other, kind: 'rect', t, idx: 'a1' as FracIdx, style } },
      { author: 'the-real-author', at: 0 },
    );

    expect(result.ok).toBe(true);
    const op: PatchOp | undefined = result.ok ? result.patch[0] : undefined;
    expect(op?.op).toBe('put');
    expect(op?.op === 'put' ? op.values.author : undefined).toBe('the-real-author');
  });

  it('ignores an author and a version the draft tries to carry', () => {
    // `ShapeDraft` omits both, so this can only arrive through a cast — which is exactly how
    // it arrives in practice: parsed from JSON, forwarded from a peer, or sent by a client
    // that lies about who it is. Omitting them from the type makes a forgery unrepresentable
    // in *our* code; this is what makes it ineffective in everyone else's.
    const forged = {
      id: other,
      kind: 'rect',
      t,
      idx: 'a1' as FracIdx,
      style,
      author: 'someone-else',
      v: 99,
    } as unknown as ShapeDraft;

    const result = reduce(scene, { kind: 'create', draft: forged }, { author: 'the-real-author', at: 0 });

    expect(result.ok).toBe(true);
    const op: PatchOp | undefined = result.ok ? result.patch[0] : undefined;
    expect(op?.op === 'put' ? op.values.author : undefined).toBe('the-real-author');
    expect(op?.op === 'put' ? op.values.v : undefined).toBe(1);
  });

  it('creates a shape in one whole-container write, not one write per field', () => {
    const patch = patchOf(EVERY_COMMAND[0]!);

    // Two clients creating the same id converge on one shape rather than a mixture of both,
    // and that is a consequence of this being one `put` rather than eight `set`s.
    expect(patch).toHaveLength(1);
    expect(patch[0]?.op).toBe('put');
  });

  it('deletes by dropping the container, not by removing keys', () => {
    const patch = patchOf({ kind: 'delete', ids: [id] });

    // A parent drop beats a concurrent child write in both clientID directions. A key-level
    // removal loses to one of them, which is how a deleted shape comes back.
    expect(patch).toEqual([{ op: 'drop', id }]);
  });
});

group('encodeShape', () => {
  it('normalises a negative zero rotation', () => {
    const turned: Shape = { ...existing, t: { ...t, rot: -0 } as unknown as Transform };

    const result = reduce(scene, { kind: 'transform', entries: [{ id, t: turned.t }] }, stamp);
    expect(result.ok).toBe(true);
    const written = result.ok && result.patch[0]?.op === 'set' ? result.patch[0].value : undefined;
    const rot =
      written !== null && typeof written === 'object' && 'rot' in written ? written['rot'] : undefined;

    // `-0` is accepted at read time because it is ordinary arithmetic, and normalised here
    // because the two encode to different bytes and the byte digest has to converge.
    expect(Object.is(rot, 0)).toBe(true);
  });
});
