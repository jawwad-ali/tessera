import { describe as group, expect, it } from 'vitest';

import { checkYjsResolution } from './index.ts';

/**
 * The harness's first test, and it is not a placeholder.
 *
 * It closes defect D-1 (this project had no test files, so `vitest run --project harness`
 * exited 1 and the CI convergence step was red while `pnpm verify` was green), and it
 * checks invariant 2 at a resolution point neither of the existing guards reaches — see
 * `yjs-resolution.ts`.
 */
group('invariant 2 at the harness resolution point', () => {
  it('resolves the same Yjs instance as @tessera/crdt', () => {
    const report = checkYjsResolution();

    expect(
      report.sameConstructor,
      `harness resolved a different Y.Doc (${report.witness}) than @tessera/crdt registered. ` +
        'Nested Y types cannot cross between two instances, while binary updates can - so ' +
        'the convergence suite would build corrupt replicas that still sync. ' +
        'Run `node scripts/check-single-yjs.ts` and `pnpm arch`.',
    ).toBe(true);
  });

  it('carries nested types across a wire round trip', () => {
    // The behaviour the invariant protects. With two copies in the tree this throws
    // `Unexpected content type` while `applyUpdate` keeps working, so asserting the round
    // trip covers the half a copy-count check cannot see.
    expect(checkYjsResolution().nestedTypeSurvivesRoundTrip).toBe(true);
  });
});
