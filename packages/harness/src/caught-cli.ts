import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Corpus } from './caught.ts';
import { checkCaught } from './caught.ts';

/**
 * `pnpm caught:check` — the build gate on `harness/CAUGHT.md`.
 *
 * Reads the evidence, reads the corpus, and asks git what each fixing commit actually touched.
 * The judgement lives in `caught.ts` so its refusals are unit-tested; this file only supplies
 * the three inputs and the exit code.
 */

const ROOT = resolve(import.meta.dirname, '../../..');
const CAUGHT = resolve(ROOT, 'harness/CAUGHT.md');
const CORPUS = resolve(ROOT, 'harness/seeds/regressions.json');

const read = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    process.stderr.write(`caught:check — cannot read ${path}\n`);
    process.exit(1);
  }
};

const corpus = JSON.parse(read(CORPUS)) as Corpus;

/**
 * Whether this working copy has the history the gate needs.
 *
 * A shallow clone makes every sha look absent, so the checker would blame the evidence file
 * for a defect in the checkout. It failed exactly that way the first time it ran in CI —
 * `actions/checkout` is depth-1 by default — and reported "fixing sha 974989f ... does not
 * exist" about a commit that plainly did. A gate that misidentifies its own failure is worse
 * than one that is merely strict, so this is checked first and named.
 */
const isShallow = (): boolean => {
  try {
    return (
      execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === 'true'
    );
  } catch {
    return false;
  }
};

if (isShallow()) {
  process.stderr.write(
    'caught:check — this is a shallow clone, so the fixing commits in harness/CAUGHT.md ' +
      'cannot be inspected. Fetch full history (actions/checkout with fetch-depth: 0).\n',
  );
  process.exit(1);
}

/**
 * Files one commit touched.
 *
 * Returns an empty list for a sha git does not know, which the checker reports as "touches no
 * files, or does not exist" — a row naming a commit that is not in history is exactly as
 * broken as one naming a commit that changed nothing. Shallowness is ruled out above, so an
 * empty result here means the row is wrong rather than the checkout.
 */
const filesTouched = (sha: string): readonly string[] => {
  try {
    return execFileSync('git', ['show', '--name-only', '--format=', sha], {
      cwd: ROOT,
      encoding: 'utf8',
      // git writes its own "unknown revision" complaint to stderr; the empty result is the
      // answer this checker wants, and the noise would look like a crash.
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
};

const problems = checkCaught({ markdown: read(CAUGHT), corpus, filesTouched });

if (problems.length > 0) {
  process.stderr.write(`caught:check — ${problems.length} problem(s) with harness/CAUGHT.md:\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}

process.stdout.write(
  `caught:check — harness/CAUGHT.md is complete, ${corpus.entries.length} corpus entr(ies).\n`,
);
