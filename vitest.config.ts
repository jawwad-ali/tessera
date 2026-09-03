import { defineConfig } from 'vitest/config';

/**
 * One project per package, because they run in genuinely different environments:
 * `core` must pass with no yjs and no DOM present (ARCHITECTURE.md §3), the renderer
 * needs a DOM, and the property suite is a long-running node process.
 */
export default defineConfig({
  test: {
    projects: [
      {
        // The purity guarantee is worth testing, not just linting: this project runs with
        // `deps.moduleDirectories` untouched but no yjs import anywhere in the graph, so a
        // stray dependency shows up as a resolution failure here too.
        test: { name: 'core', root: 'packages/core', environment: 'node',
          setupFiles: ['../../vitest.setup.ts'], include: ['src/**/*.test.ts'] },
      },
      {
        test: { name: 'protocol', root: 'packages/protocol', environment: 'node',
          setupFiles: ['../../vitest.setup.ts'], include: ['src/**/*.test.ts'] },
      },
      {
        test: { name: 'crdt', root: 'packages/crdt', environment: 'node',
          setupFiles: ['../../vitest.setup.ts'], include: ['src/**/*.test.ts'] },
      },
      {
        test: { name: 'relay', root: 'apps/relay', environment: 'node',
          setupFiles: ['../../vitest.setup.ts'], include: ['src/**/*.test.ts'] },
      },
      {
        test: { name: 'web', root: 'apps/web', environment: 'jsdom', include: ['src/**/*.test.ts'] },
      },
      {
        // Convergence and invariants. Slower by design — it drives N replicas through
        // randomised delivery orders and asserts at every intermediate state.
        test: {
          name: 'harness',
          root: 'packages/harness',
          environment: 'node',
          setupFiles: ['../../vitest.setup.ts'],
          include: ['src/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', 'packages/harness/**'],
      // core is pure logic with no I/O and no excuses. The rest carry integration seams
      // that are covered by the property suite and the smoke test rather than by units.
      thresholds: {
        'packages/core/src/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'packages/protocol/src/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  },
});
