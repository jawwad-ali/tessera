import { findBrokenCitations } from './claims.ts';

/**
 * `pnpm claims:check` — refuse a document that cites a file which does not exist.
 *
 * Scope is deliberate, not maximal. README.md claims what is built *today*, so all of its
 * citations are checked. ARCHITECTURE.md and PHASES.md legitimately name files a future phase
 * creates, so only their `bench/` citations are checked — because those claim a number is
 * reproducible, which is the one forward-looking reference that must already be true.
 */

const repoRoot = process.cwd().replace(/packages[\/]harness$/, '');

const broken = [
  ...findBrokenCitations(['README.md'], repoRoot),
  ...findBrokenCitations(
    ['ARCHITECTURE.md', 'PHASES.md', 'CLAUDE.md'],
    repoRoot,
    /^bench\//,
  ),
];

if (broken.length > 0) {
  console.error('claims:check FAILED — documents cite paths that do not exist:\n');
  for (const entry of broken) console.error(`  ${entry.doc}:${String(entry.line)} -> ${entry.path}`);
  console.error(
    '\nEither create the file or stop claiming it. A README that describes more than the\n' +
      'tree contains is the failure this gate exists to prevent (defect D-2).',
  );
  process.exit(1);
}

console.log('claims:check ok — every cited path exists');
