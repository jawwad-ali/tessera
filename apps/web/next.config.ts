import type { NextConfig } from 'next';

/**
 * Workspace packages are consumed as TypeScript source (ARCHITECTURE.md §3) — there is no
 * build step and therefore no stale dist — so Next has to transpile them itself.
 */
const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tessera/core', '@tessera/crdt', '@tessera/protocol'],

  typescript: {
    // The root `pnpm typecheck` is the gate. Duplicating it in the build just makes the
    // build slower and the failure appear in two places.
    ignoreBuildErrors: false,
  },

  // NOTE (ARCHITECTURE.md §7, and the reason `next dev` numbers are not publishable):
  // reactStrictMode double-invokes effects in development, which yields two rAF loops, two
  // Y.Docs, two WebSocket connections, two IndexedDB providers, and a duplicate of your own
  // awareness cursor. It is left ON because it surfaces exactly the effect-cleanup bugs the
  // board host must not have — but every frame-time and cold-load measurement has to be
  // taken against `next build && next start`, never `next dev`.
};

export default config;
