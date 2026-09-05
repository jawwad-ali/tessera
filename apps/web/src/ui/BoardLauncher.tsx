'use client';

import { nanoid } from 'nanoid';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * "New board" and the recent list.
 *
 * Recents live in `localStorage`, which is read in an effect and never during render: the server
 * has no storage, so rendering from it would hydrate a different list than the server sent and
 * React would flag the mismatch. Until the effect runs the list is empty, which is also what a
 * first-time visitor sees.
 */

const RECENTS_KEY = 'tessera:recent-boards';
const MAX_RECENTS = 8;

interface Recent {
  readonly id: string;
  readonly openedAt: number;
}

const readRecents = (): readonly Recent[] => {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Recent =>
        typeof entry === 'object' && entry !== null && typeof (entry as Recent).id === 'string' && typeof (entry as Recent).openedAt === 'number',
    );
  } catch {
    return [];
  }
};

export const rememberBoard = (id: string): void => {
  try {
    const rest = readRecents().filter((entry) => entry.id !== id);
    const next = [{ id, openedAt: Date.now() }, ...rest].slice(0, MAX_RECENTS);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Storage can be full or blocked. A missing recent is not worth an error.
  }
};

export const BoardLauncher = () => {
  const router = useRouter();
  const [recents, setRecents] = useState<readonly Recent[]>([]);

  useEffect(() => {
    setRecents(readRecents());
  }, []);

  const create = (): void => {
    const id = nanoid(10);
    rememberBoard(id);
    router.push(`/b/${id}`);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="new-board"
          onClick={create}
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          New board
        </button>
        <Link
          href="/b/demo?seed=1&n=5000"
          className="inline-flex items-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          Open the 5,000-shape demo
        </Link>
      </div>

      {recents.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-slate-700">Recent boards on this device</h2>
          <ul className="space-y-1">
            {recents.map((recent) => (
              <li key={recent.id}>
                <Link href={`/b/${recent.id}`} className="text-sm text-slate-600 underline-offset-2 hover:underline">
                  /b/{recent.id}
                </Link>
                <span className="ml-2 text-xs text-slate-400">
                  {new Date(recent.openedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Recent means the link, not the drawing: boards are not saved yet, so these open empty.
          </p>
        </div>
      )}
    </section>
  );
};
