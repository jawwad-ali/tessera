import { describe as group, expect, it } from 'vitest';

import { fitToContent, transformBounds } from '@tessera/core';
import { FIXTURE_MAX, boardBounds, seededBoard } from './fixture.ts';

/**
 * The seeded demo board.
 *
 * The describe name matches the verifier in PHASES.md (`-t fixture`).
 *
 * `/b/demo?seed=&n=` has to produce the same board for everyone who opens it, or the link is
 * not shareable and the pixel assertions in `3.C1` have nothing fixed to assert against.
 */

group('fixture', () => {
  it('gives everyone who opens the link the same board', () => {
    const first = seededBoard(7, 50);
    const second = seededBoard(7, 50);

    const fingerprint = (store: ReturnType<typeof seededBoard>) =>
      store.drawOrder().map((shape) => `${shape.id}:${shape.idx}:${JSON.stringify(shape.t)}:${shape.style.fill}`);

    // Every field, not just the count: a board that agrees on how many shapes there are and
    // disagrees on where they are is worse than one that disagrees outright, because the
    // screenshots look plausible.
    expect(fingerprint(first)).toEqual(fingerprint(second));
  });

  it('gives a different seed a different board', () => {
    const a = seededBoard(1, 50);
    const b = seededBoard(2, 50);

    expect(a.drawOrder().map((s) => JSON.stringify(s.t))).not.toEqual(
      b.drawOrder().map((s) => JSON.stringify(s.t)),
    );
  });

  it('creates exactly the shapes it was asked for', () => {
    expect(seededBoard(1, 0).drawOrder()).toHaveLength(0);
    expect(seededBoard(1, 1).drawOrder()).toHaveLength(1);
    expect(seededBoard(1, 500).drawOrder()).toHaveLength(500);
  });

  it('refuses a shape count that would make the demo a denial of service', () => {
    // `n` comes from the query string, so it is untrusted input on a public URL. 5,000 is what
    // the phase measures; a request for five million is a tab that never loads.
    expect(seededBoard(1, 5_000_000).drawOrder()).toHaveLength(FIXTURE_MAX);
    expect(seededBoard(1, -10).drawOrder()).toHaveLength(0);
    expect(seededBoard(1, Number.NaN).drawOrder()).toHaveLength(0);
  });

  it('spreads shapes over an area that makes zoom-to-fit a real zoom', () => {
    const store = seededBoard(3, 400);
    const bounds = boardBounds(store);

    // A board that fits on screen at zoom 1 never exercises the camera, and zoom-to-fit is
    // both the first thing every user does and this renderer's worst case.
    expect(bounds.w).toBeGreaterThan(2_000);
    expect(bounds.h).toBeGreaterThan(2_000);

    const camera = fitToContent(bounds, { x: 800, y: 600 });
    expect(camera.zoom).toBeLessThan(0.5);
  });

  it('keeps every shape inside the bounds it reports', () => {
    const store = seededBoard(11, 200);
    const bounds = boardBounds(store);

    for (const shape of store.drawOrder()) {
      const box = transformBounds(shape.t);
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.y).toBeGreaterThanOrEqual(bounds.y);
      expect(box.x + box.w).toBeLessThanOrEqual(bounds.x + bounds.w);
      expect(box.y + box.h).toBeLessThanOrEqual(bounds.y + bounds.h);
    }
  });

  it('reports empty bounds for an empty board rather than an infinity', () => {
    // `fitToContent` returns the default camera for degenerate content, and it can only do
    // that if it is handed zeroes instead of `Infinity` from an empty reduce.
    expect(boardBounds(seededBoard(1, 0))).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
