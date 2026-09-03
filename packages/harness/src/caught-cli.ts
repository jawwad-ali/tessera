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
 * Files one commit touched.
 *
 * Returns an empty list for a sha git does not know, which the checker reports as "touches no
 * files, or does not exist" — a row naming a commit that is not in history is exactly as
 * broken as one naming a commit that changed nothing.
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
