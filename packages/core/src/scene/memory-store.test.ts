import { describe as group, expect, it } from 'vitest';

import type { FracIdx, ShapeDraft, ShapeId, Style, Transform } from '../schema/shape.ts';
import { createMemoryStore } from './memory-store.ts';

/**
 * Drawing on the board.
 *
 * This is Phase 1's actual journey and the smallest increment that describes it: a user
 * draws a rectangle, and it is on the board, in draw order, attributed to them.
 *
 * The describe names match the verifier commands in PHASES.md (`-t opCount`,
 * `-t "round trip"`) so those criteria select real tests rather than an empty set.
 */

const rectDraft = (id: string, idx: string): ShapeDraft => ({
    id: id as ShapeId,
    kind: 'rect',
    t: { x: 0, y: 0, w: 10, h: 10, rot: 0 } as unknown as Transform,
    idx: idx as FracIdx,
    style: {
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 1,
      opacity: 1,
    } as unknown as Style,
});

group('opCount', () => {
  it('drawing one rectangle puts it on the board', () => {
    const store = createMemoryStore({ author: 'u1', now: () => 0 });
    const id = 's1' as ShapeId;

    const result = store.gesture((tx) => tx.apply({ kind: 'create', draft: rectDraft('s1', 'a0') }));

    expect(result.committed).toBe(true);
    // One whole-map write, not one per field. A create is a single `put` at the root key,
    // which is why two clients creating the same id produce one shape rather than a chimera.
    expect(result.opCount).toBe(1);

    const drawn = store.get(id);
    expect(drawn?.t.w).toBe(10);
    // Attribution is stamped by the store, never taken from the draft — `ShapeDraft` omits
    // `author` and `v` precisely so a forged one is unrepresentable.
    expect(drawn?.author).toBe('u1');
    expect(drawn?.v).toBe(1);

    expect(store.drawOrder().map((shape) => shape.id)).toEqual([id]);
  });
});
