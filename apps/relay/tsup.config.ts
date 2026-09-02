import { defineConfig } from 'tsup';

/**
 * The relay ships as one bundled file. Workspace packages are TypeScript source, so they
 * are compiled in here rather than resolved at runtime — which also means the deployed
 * container carries no pnpm symlink farm and cannot accidentally resolve a second copy of
 * yjs (ARCHITECTURE.md invariant 2).
 */
export default defineConfig({
  entry: ['src/main.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  bundle: true,
  sourcemap: true,
  clean: true,
  // Bundle the workspace and yjs; leave anything with a native or optional binding alone.
  noExternal: ['@tessera/core', '@tessera/crdt', '@tessera/protocol', 'yjs', 'y-protocols', 'lib0'],
  external: ['pg', 'pg-native', 'ioredis', 'ws', 'bufferutil', 'utf-8-validate'],
});
