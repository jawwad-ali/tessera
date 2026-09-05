import { BoardLauncher } from '../src/ui/BoardLauncher.tsx';

/**
 * The landing page. Chrome only — the App Router owns routing and nothing else here.
 *
 * It says plainly what exists. A portfolio piece that implies more than it does reads as a
 * prototype the moment someone clicks; the banner is the declared limit PHASES.md requires until
 * persistence lands.
 */
const Home = () => (
  <main className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-6 px-6">
    <header className="space-y-2">
      <h1 className="text-3xl font-semibold tracking-tight">Tessera</h1>
      <p className="text-slate-600">
        A multiplayer whiteboard with CRDT sync. Hand-written canvas renderer, hand-written relay, no
        canvas library.
      </p>
    </header>

    <section role="note" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <strong>Single-player, ephemeral.</strong> Draw rectangles, select, move, delete and undo. Nothing is saved
      and nobody else can see your board yet — sync and persistence arrive in later phases.
    </section>

    <BoardLauncher />

    <p className="text-xs text-slate-500">
      V select · R rectangle · drag to move · Delete · Ctrl+Z undo · hold Space and drag to pan · Ctrl+scroll
      to zoom.
    </p>
  </main>
);

export default Home;
