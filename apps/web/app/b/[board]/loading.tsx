/**
 * Shown while the route segment resolves. The board itself streams in behind `BoardClient`'s
 * own `ssr: false` placeholder, so this covers only the server half of the wait.
 */
const Loading = () => (
  <div role="status" aria-live="polite" className="h-full w-full animate-pulse bg-slate-50" />
);

export default Loading;
