import fc from 'fast-check';

import type { ShapeId } from '@tessera/core';
import { checkCommand, checkScene, createMemoryStore } from '@tessera/core';
import type { Plan } from './plan.ts';
import { emit, planArb, seededRng } from './plan.ts';

/**
 * Measure what a planted mutant costs the suite to find.
 *
 * `harness/CAUGHT.md` has to publish three numbers per row — seeds to first failure, shrink
 * length in actions, wall-clock — and `2.C3` exists because those numbers are the difference
 * between "the suite has teeth" as a claim and as a result. Typing them by hand is how they
 * drift, so this produces them.
 *
 * Uses `fc.check` rather than `fc.assert`: it returns the run details instead of throwing, so
 * the seed count at first failure and the shrink count are readable rather than parsed back
 * out of an error message.
 *
 * Run against a tree that has the mutant planted **and** the invariant present. That state is
 * red by construction and therefore never committed; `CAUGHT.md` names the two commits it is
 * reconstructed from.
 */

const RUNS = Number(process.env['TESSERA_RUNS'] ?? 2000);
const SEED = Number(process.env['TESSERA_SEED'] ?? 20260903);

const violationsOf = (plan: Plan): readonly string[] => {
  const store = createMemoryStore({ author: 'u1', now: () => 0 });
  const rng = seededRng(plan.rngSeed);
  let minted = 0;
  const nextId = (): ShapeId => {
    minted += 1;
    return `s${minted}` as ShapeId;
  };

  for (const action of plan.actions) {
    const emitted = emit(action, store.drawOrder(), nextId, rng);

    const patchFaults = emitted.commands.flatMap((command) =>
      checkCommand(store, command, { author: 'u1', at: 0 }),
    );
    if (patchFaults.length > 0) {
      return patchFaults.map((violation) => `${violation.invariant}: ${violation.detail}`);
    }

    store.gesture((tx) => {
      for (const command of emitted.commands) tx.apply(command);
    });
    const found = checkScene(store);
    if (found.length > 0) {
      return found.map(
        (violation) =>
          `${violation.invariant}${violation.id === undefined ? '' : ` on ${violation.id}`}: ${violation.detail}`,
      );
    }
  }
  return [];
};

const started = Date.now();
const outcome = fc.check(
  fc.property(planArb, (plan) => violationsOf(plan).length === 0),
  { numRuns: RUNS, seed: SEED },
);
const elapsed = Date.now() - started;

if (!outcome.failed) {
  process.stdout.write(
    `NOT CAUGHT — ${RUNS} seeds at seed ${SEED} in ${elapsed}ms found nothing.\n` +
      'Either no mutant is planted, or its invariant is still deleted, or the suite is blind to it.\n',
  );
  process.exit(1);
}

const shrunk = outcome.counterexample?.[0];
const actions = shrunk === undefined ? 0 : shrunk.actions.length;
const kinds = shrunk === undefined ? '' : shrunk.actions.map((action) => action.kind).join(' -> ');

/**
 * Commands the shrunk plan actually emits.
 *
 * Reported alongside the action count because the two are different numbers and only one of
 * them is the size of the counterexample a person reads. One action can be 300 commands: a
 * drag emits a transform per frame, which is the whole reason staging collapse exists.
 */
const commandsOf = (plan: Plan | undefined): number => {
  if (plan === undefined) return 0;
  const store = createMemoryStore({ author: 'u1', now: () => 0 });
  const rng = seededRng(plan.rngSeed);
  let minted = 0;
  const nextId = (): ShapeId => {
    minted += 1;
    return `s${minted}` as ShapeId;
  };
  let total = 0;
  for (const action of plan.actions) {
    const emitted = emit(action, store.drawOrder(), nextId, rng);
    total += emitted.commands.length;
    store.gesture((tx) => {
      for (const command of emitted.commands) tx.apply(command);
    });
  }
  return total;
};
const detail = shrunk === undefined ? [] : violationsOf(shrunk);

process.stdout.write(
  [
    'CAUGHT',
    `  seeds to first failure : ${outcome.numRuns}`,
    `  shrinks               : ${outcome.numShrinks}`,
    `  shrink length         : ${actions} actions / ${commandsOf(shrunk)} commands`,
    `  wall-clock            : ${elapsed}ms`,
    `  base seed             : ${SEED}`,
    `  shrunk plan           : ${kinds}`,
    `  rng seed              : ${shrunk?.rngSeed ?? '-'}`,
    `  invariant fired       : ${detail[0] ?? '(re-run produced none — non-deterministic!)'}`,
    '',
  ].join('\n'),
);
