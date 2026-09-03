import fc from 'fast-check';

/**
 * One seed for every property test in the repo.
 *
 * Written after a property test in `camera.test.ts` was found failing roughly one run in six.
 * The failure was real — see `closeAfterRoundTrip` — but the *cost* was that it could not be
 * reproduced: 33 `fc.assert` calls, none of them seeded, so a red run left nothing to act on
 * and a green run proved nothing about the run before it. An unreproducible flake is worse
 * than a deterministic failure, because it teaches the team to re-run instead of to look.
 *
 * Overridable, because a suite pinned to one seed forever stops finding anything new — it
 * re-runs the same cases on every commit. CI runs the fixed seed so a failure is actionable;
 * an exploratory run sets `TESSERA_SEED` and anything it finds becomes a committed regression.
 */
const seed = Number(process.env['TESSERA_SEED'] ?? 20260903);

fc.configureGlobal({ seed, verbose: true });

if (process.env['TESSERA_SEED'] !== undefined) {
  process.stdout.write(`fast-check seed override: ${seed}\n`);
}
