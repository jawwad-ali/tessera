'use client';

import { nanoid } from 'nanoid';
import { useEffect, useMemo, useRef } from 'react';

import type { Camera } from '@tessera/core';
import { DEFAULT_CAMERA, createMemoryStore } from '@tessera/core';
import { rememberBoard } from '../ui/BoardLauncher.tsx';
import { Toolbar } from '../ui/Toolbar.tsx';
import { createController } from './controller.ts';
import { seededBoard } from './fixture.ts';
import { useBoardCanvas } from './use-board-canvas.ts';

/**
 * The board: two canvases, a toolbar, and the controller that binds them.
 *
 * Mounted through `BoardClient` with `ssr: false`, so this file never runs on the server.
 *
 * Two canvases, stacked. The static layer holds committed shapes and is the one whose pixels
 * `3.C1` and `4.C1` read back; the overlay holds the gesture in flight, the marquee and the
 * handles, and is the one that receives pointer events because it is on top.
 */

/** Hit slop in CSS pixels, converted to board units by the zoom at hit time. ARCHITECTURE §7. */
const HIT_SLOP_CSS = 10;

export interface BoardHostProps {
  readonly boardId: string;
  /** Present for the seeded demo; absent for a fresh board, which starts empty. */
  readonly seed: number | undefined;
  readonly count: number;
  readonly bench: boolean;
}

export const BoardHost = ({ boardId, seed, count, bench }: BoardHostProps) => {
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  // Owned here rather than by the hook, because the controller's hit slop has to read the zoom.
  const cameraRef = useRef<Camera>(DEFAULT_CAMERA);

  const store = useMemo(
    () => (seed === undefined ? createMemoryStore({ author: 'local', now: () => Date.now() }) : seededBoard(seed, count)),
    [seed, count],
  );

  const controller = useMemo(
    () =>
      createController(store, {
        slop: () => HIT_SLOP_CSS / cameraRef.current.zoom,
        nextId: () => nanoid(),
        rng: Math.random,
        onGesture: (result) => {
          window.__tessera?.gestures.push({ committed: result.committed, opCount: result.opCount });
        },
      }),
    [store],
  );

  useBoardCanvas({ staticRef, overlayRef, cameraRef, store, controller, bench });

  // A fresh board goes on the device's recent list. The seeded demo does not: it is a fixture,
  // and listing it would suggest the drawing persists when only the seed does.
  useEffect(() => {
    if (seed === undefined) rememberBoard(boardId);
  }, [boardId, seed]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-white">
      <canvas ref={staticRef} data-testid="board" aria-hidden="true" className="absolute inset-0 block h-full w-full" />
      <canvas
        ref={overlayRef}
        data-testid="board-overlay"
        role="application"
        aria-label="Whiteboard. V to select, R to draw rectangles, drag to move, Delete to remove, Ctrl+Z to undo. Hold space and drag to pan; ctrl+scroll to zoom."
        tabIndex={0}
        // `touch-action: none` hands every touch to the pointer events. Without it a one-finger
        // drag scrolls the page instead of the board and a pinch zooms the page.
        className="absolute inset-0 block h-full w-full touch-none outline-none"
      />
      <Toolbar controller={controller} />
    </div>
  );
};
