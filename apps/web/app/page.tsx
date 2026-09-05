import Link from 'next/link';

/**
 * The landing page. Chrome only — the App Router owns routing and nothing else here.
 *
 * Phase 3 ships one thing: a read-only renderer demo. This page says so plainly, because a
 * portfolio piece that implies more than it does reads as a prototype the moment someone
 * clicks. The banner is the ephemerality caption PHASES.md requires until persistence exists.
 */
const Home = () => (
  <main className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-6 px-6">
    <header className="space-y-2">
      <h1 className="text-3xl font-semibold tracking-tight">Tessera</h1>
      <p className="text-slate-600">
        A multiplayer whiteboard with CRDT sync. Hand-written canvas renderer, hand-written
        relay, no canvas library.
      </p>
    </header>

    <section
      role="note"
      className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <strong>Read-only renderer demo.</strong> Nothing you do here is saved and nobody else can
      see it. Drawing, selection and sync arrive in later phases.
    </section>

    <Link
      href="/b/demo?seed=1&n=5000"
      className="inline-flex w-fit items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
    >
      Open a 5,000-shape board
    </Link>

    <p className="text-xs text-slate-500">
      Drag to pan. Ctrl+scroll or pinch to zoom. The board is seeded, so the link shows everyone
      the same shapes.
    </p>
  </main>
);

export default Home;
