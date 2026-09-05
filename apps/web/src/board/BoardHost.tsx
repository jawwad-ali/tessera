'use client';

import { useMemo, useRef } from 'react';

import { seededBoard } from './fixture.ts';
import { useBoardCanvas } from './use-board-canvas.ts';

/**
 * The canvas, and nothing else.
 *
 * Mounted through `BoardClient` with `ssr: false`, so this file never runs on the server:
 * `devicePixelRatio`, `ResizeObserver` and the canvas context are all read freely in the
 * hook because there is no hydration pass to disagree with.
 *
 * The store is built here from the seed rather than passed in, because a `SceneStore` holds
 * a `Map` and a spatial index and is not something that can cross the server/client boundary
 * as a prop. The seed can.
 */

export interface BoardHostProps {
  readonly seed: number;
  readonly count: number;
  readonly bench: boolean;
}

export const BoardHost = ({ seed, count, bench }: BoardHostProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Rebuilt only when the URL changes. A rebuild per render would throw away the spatial
  // index and re-create 5,000 shapes on every parent re-render.
  const store = useMemo(() => seededBoard(seed, count), [seed, count]);

  useBoardCanvas(canvasRef, { store, bench });

  return (
    <canvas
      ref={canvasRef}
      data-testid="board"
      aria-label={`Read-only board with ${count} shapes. Drag to pan, ctrl+scroll to zoom.`}
      // `touch-action: none` hands every touch to the pointer events. Without it, a one-finger
      // drag on a phone scrolls the page instead of the board and a pinch zooms the page.
      className="block h-full w-full touch-none bg-white"
    />
  );
};
