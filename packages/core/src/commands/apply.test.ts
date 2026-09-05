import { describe as group, expect, it } from 'vitest';

import type { Command, Patch, PatchOp, ScenePeek } from './command.ts';
import type { FracIdx, Shape, ShapeDraft, ShapeId, Style, Transform } from '../schema/shape.ts';
import { COMMAND_TOUCHES, checkPatch, invert, reduce, selectionBounds } from './apply.ts';

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
  it('passes every patch the five real commands actually produce', () => {
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

group('invert', () => {
  it('undoing a draw removes the shape, exactly', () => {
    // The one exact inverse. A create's inverse is a parent drop, which beats every concurrent
    // child write in both directions, so nothing a peer did in between can be lost.
    const inverse = invert(scene, {
      kind: 'create',
      draft: { id: other, kind: 'rect', t, idx: 'a1' as FracIdx, style },
    });

    expect(inverse).toEqual({ kind: 'exact', cmd: { kind: 'delete', ids: [other] } });
  });

  it('undoing a move puts the shape back where it was, and says what that costs', () => {
    const moved = { x: 500, y: 500, w: 10, h: 10, rot: 0 } as unknown as Transform;

    const inverse = invert(scene, { kind: 'transform', entries: [{ id, t: moved }] });

    // The inverse carries the geometry the shape had BEFORE the move — read from the scene now,
    // because after the move it is gone. Lossy in multiplayer: a peer who moved it in between
    // has their move overwritten by ours coming back.
    expect(inverse).toEqual({
      kind: 'lossy',
      loses: 'stale-geometry-restored',
      cmd: { kind: 'transform', entries: [{ id, t: existing.t }] },
    });
  });

  it('undoing a recolour restores the previous style', () => {
    const red = { ...style, fill: '#ff0000' } as Style;

    const inverse = invert(scene, { kind: 'restyle', entries: [{ id, style: red }] });

    expect(inverse.kind).toBe('lossy');
    expect(inverse.kind === 'lossy' ? inverse.cmd : undefined).toEqual({
      kind: 'restyle',
      entries: [{ id, style: existing.style }],
    });
  });

  it('undoing a restack restores the previous position in the stack', () => {
    const inverse = invert(scene, { kind: 'reorder', entries: [{ id, idx: 'a9' as FracIdx }] });

    expect(inverse.kind === 'lossy' ? inverse.cmd : undefined).toEqual({
      kind: 'reorder',
      entries: [{ id, idx: existing.idx }],
    });
  });

  it('undoing a delete brings the shape back as it was', () => {
    const inverse = invert(scene, { kind: 'delete', ids: [id] });

    // Resurrection is a create from the shape as it stood. Lossy for a named reason: a peer's
    // concurrent restyle of the deleted shape was annihilated by the parent drop and does not
    // come back with it.
    expect(inverse.kind).toBe('lossy');
    expect(inverse.kind === 'lossy' ? inverse.loses : undefined).toBe('peer-restyle-lost-on-resurrect');
    const cmd = inverse.kind === 'lossy' ? inverse.cmd : undefined;
    expect(cmd?.kind).toBe('create');
    expect(cmd?.kind === 'create' ? cmd.draft : undefined).toEqual({
      id,
      kind: 'rect',
      t: existing.t,
      idx: existing.idx,
      style: existing.style,
    });
  });

  it('has no inverse for a command naming a shape that is not there', () => {
    // Nothing to restore. Reported as `none` rather than a guess, because an undo that
    // re-creates a shape from thin air is worse than an undo that does nothing.
    expect(invert(scene, { kind: 'transform', entries: [{ id: other, t }] })).toEqual({ kind: 'none' });
    expect(invert(scene, { kind: 'delete', ids: [other] })).toEqual({ kind: 'none' });
  });

  it('inverts a group move entry by entry', () => {
    // A three-shape drag is one command with three entries, so its inverse is one command
    // with three entries — one undo step, as the gesture was one gesture.
    const third = 's3' as ShapeId;
    const twoShapes: ScenePeek = {
      get: (wanted) => (wanted === id || wanted === third ? { ...existing, id: wanted } : undefined),
      has: (wanted) => wanted === id || wanted === third,
    };
    const moved = { x: 1, y: 1, w: 10, h: 10, rot: 0 } as unknown as Transform;

    const inverse = invert(twoShapes, {
      kind: 'transform',
      entries: [
        { id, t: moved },
        { id: third, t: moved },
      ],
    });

    expect(inverse.kind === 'lossy' ? inverse.cmd : undefined).toEqual({
      kind: 'transform',
      entries: [
        { id, t: existing.t },
        { id: third, t: existing.t },
      ],
    });
  });
});

group('selectionBounds', () => {
  it('is the box around everything selected', () => {
    const far = 's3' as ShapeId;
    const twoShapes: ScenePeek = {
      get: (wanted) =>
        wanted === id
          ? existing
          : wanted === far
            ? { ...existing, id: far, t: { x: 100, y: 100, w: 10, h: 10, rot: 0 } as unknown as Transform }
            : undefined,
      has: (wanted) => wanted === id || wanted === far,
    };

    // `existing` is at (5, 20) 10x10, the other at (100, 100) 10x10.
    expect(selectionBounds(twoShapes, [id, far])).toEqual({ x: 5, y: 20, w: 105, h: 90 });
  });

  it('accounts for rotation, because the handles go around what is painted', () => {
    const turned: ScenePeek = {
      get: () => ({ ...existing, t: { x: 0, y: 0, w: 40, h: 10, rot: Math.PI / 2 } as unknown as Transform }),
      has: () => true,
    };

    const bounds = selectionBounds(turned, [id]);

    // A quarter-turned wide rect is a tall box, centred where the shape is centred.
    expect(bounds?.w).toBeCloseTo(10, 6);
    expect(bounds?.h).toBeCloseTo(40, 6);
  });

  it('is undefined for an empty selection or one that no longer exists', () => {
    expect(selectionBounds(scene, [])).toBeUndefined();
    expect(selectionBounds(scene, [other])).toBeUndefined();
  });

  it('ignores ids that have gone and boxes the rest', () => {
    expect(selectionBounds(scene, [id, other])).toEqual({ x: 5, y: 20, w: 10, h: 10 });
  });
});
