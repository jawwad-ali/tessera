'use client';

import dynamic from 'next/dynamic';

import type { BoardHostProps } from './BoardHost.tsx';

/**
 * The SSR boundary.
 *
 * `BoardHost` reads `devicePixelRatio` and creates a canvas context, neither of which exists on
 * the server. Rendering it there would either throw or hydrate a canvas at the wrong size and
 * repaint it a frame later — a visible flash on every load. `ssr: false` means the server ships
 * this placeholder and the client swaps in the real host after hydration.
 *
 * `next/dynamic` with `ssr: false` has to be called from a client component, which is the only
 * reason this file exists separately from the page.
 */
const BoardHost = dynamic(() => import('./BoardHost.tsx').then((mod) => mod.BoardHost), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full w-full items-center justify-center bg-white text-sm text-slate-500"
    >
      Preparing the board…
    </div>
  ),
});

export const BoardClient = (props: BoardHostProps) => <BoardHost {...props} />;
