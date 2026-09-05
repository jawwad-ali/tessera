import { BoardClient } from '../../../src/board/BoardClient.tsx';

/**
 * `/b/[board]?seed=&n=&bench=` — the seeded, read-only board.
 *
 * A server component that does one thing: parse the query string into numbers and hand them
 * to the client boundary. The store itself is built on the client, because a `SceneStore`
 * cannot be serialised across the boundary and the seed can.
 *
 * `n` is parsed here and clamped in the fixture. Both ends are untrusted-input boundaries:
 * this one turns a string into a number, the fixture turns a number into a count a browser
 * survives.
 */

interface BoardPageProps {
  readonly params: Promise<{ readonly board: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_SEED = 1;
const DEFAULT_COUNT = 5_000;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const numberOr = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const BoardPage = async ({ searchParams }: BoardPageProps) => {
  const query = await searchParams;
  const seed = numberOr(first(query['seed']), DEFAULT_SEED);
  const count = numberOr(first(query['n']), DEFAULT_COUNT);
  const bench = first(query['bench']) === '1';

  return (
    <main className="h-full w-full">
      <BoardClient seed={seed} count={count} bench={bench} />
    </main>
  );
};

export default BoardPage;
